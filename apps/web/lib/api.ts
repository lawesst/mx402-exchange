import type {
  ActivityItem,
  CreatedProjectApiKey,
  BuyerProject,
  ChainOverview,
  MarketplaceProduct,
  ProductDetail,
  AdminProviderRecord,
  ProjectApiKey,
  ProjectDetail,
  PreparedProviderClaim,
  ProviderProfile,
  ProviderClaimRefresh,
  ProviderEarnings,
  ProviderProduct,
  SettlementBatchRecord,
  SettlementRefreshResult,
  UsageEvent,
  UsageReceipt,
  ViewerResponse,
  MirrorTransaction,
  WalletAccount,
  WalletTransaction
} from './types';

const WALLET_CHAIN_API_BASE = process.env.NEXT_PUBLIC_MULTIVERSX_API_URL ?? 'https://devnet-api.multiversx.com';
const CHAIN_STATUS_API_BASE = WALLET_CHAIN_API_BASE;
const INTERNAL_API_PROXY_PATH = '/__mx402_api';
const GATEWAY_PROXY_PATH = '/__mx402_gateway';

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveLoopbackBaseUrl(envValue: string | undefined, fallbackPort: number): string {
  if (typeof window === 'undefined') {
    return normalizeUrl(envValue ?? `http://localhost:${fallbackPort}`);
  }

  const fallbackUrl = `${window.location.protocol}//${window.location.hostname}:${fallbackPort}`;
  if (!envValue) {
    return normalizeUrl(fallbackUrl);
  }

  try {
    const url = new URL(envValue);
    const currentHost = window.location.hostname;
    const loopbackHosts = new Set(['localhost', '127.0.0.1']);

    if (loopbackHosts.has(url.hostname) && loopbackHosts.has(currentHost)) {
      url.protocol = window.location.protocol;
      url.hostname = currentHost;
      return normalizeUrl(url.toString());
    }

    return normalizeUrl(url.toString());
  } catch {
    return normalizeUrl(envValue);
  }
}

function getInternalApiBase(): string {
  if (typeof window !== 'undefined') {
    return INTERNAL_API_PROXY_PATH;
  }

  return resolveLoopbackBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL, 4010);
}

function getGatewayBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return GATEWAY_PROXY_PATH;
  }

  return resolveLoopbackBaseUrl(process.env.NEXT_PUBLIC_GATEWAY_BASE_URL, 4020);
}

class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

function extractErrorMessage(payload: unknown, fallbackStatus: number) {
  if (Array.isArray(payload)) {
    const messages = payload
      .map((item) => (item && typeof item === 'object' && 'message' in item ? String((item as { message: unknown }).message) : null))
      .filter(Boolean);

    if (messages.length > 0) {
      return messages.join(', ');
    }
  }

  if (payload && typeof payload === 'object') {
    const maybePayload = payload as { error?: { message?: string } };
    if (maybePayload.error?.message) {
      return maybePayload.error.message;
    }
  }

  return `Internal request failed: ${fallbackStatus}`;
}

async function fetchInternal<T>(path: string, init?: RequestInit, allowUnauthorized = false): Promise<T | null> {
  const hasBody = init?.body !== undefined;
  const response = await fetch(`${getInternalApiBase()}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {})
    }
  });

  if (allowUnauthorized && response.status === 401) {
    return null;
  }

  if (!response.ok) {
    const payload = await parseJson<unknown>(response).catch(() => null);
    throw new HttpError(extractErrorMessage(payload, response.status), response.status);
  }

  return parseJson<T>(response);
}

async function fetchPublic<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new HttpError(`Public request failed: ${response.status}`, response.status);
  }

  return parseJson<T>(response);
}

type NetworkStatsResponse = {
  shards: number;
  blocks: number;
  accounts: number;
  transactions: number;
  refreshRate: number;
  epoch: number;
};

type EconomicsResponse = {
  price: number;
  marketCap: number;
};

type NetworkConfigResponse = {
  data: {
    config: {
      erd_min_gas_price: string;
      erd_chain_id: string;
      erd_round_duration: number;
      erd_start_time: number;
    };
  };
};

type TransactionResponse = Array<{
  txHash: string;
  sender: string;
  receiver: string;
  value: string;
  status: string;
  timestamp: number;
  function?: string;
}>;

export async function fetchMarketplaceProducts() {
  const response = await fetchInternal<{ data: MarketplaceProduct[] }>('/v1/products');
  return response?.data ?? [];
}

export async function fetchProductBySlug(slug: string): Promise<ProductDetail | null> {
  const products = await fetchMarketplaceProducts();
  const match = products.find((product) => product.slug === slug);

  if (!match) {
    return null;
  }

  return fetchInternal<ProductDetail>(`/v1/products/${match.id}`) as Promise<ProductDetail>;
}

export async function fetchChainOverview(): Promise<ChainOverview> {
  const [stats, economics, networkConfig] = await Promise.all([
    fetchPublic<NetworkStatsResponse>(`${CHAIN_STATUS_API_BASE}/stats`),
    fetchPublic<EconomicsResponse>(`${CHAIN_STATUS_API_BASE}/economics`),
    fetchPublic<NetworkConfigResponse>(`${CHAIN_STATUS_API_BASE}/network/config`)
  ]);

  const startTime = networkConfig.data.config.erd_start_time;
  const elapsedSeconds = Math.max(1, Math.floor(Date.now() / 1000) - startTime);
  const averageTps = stats.transactions / elapsedSeconds;

  return {
    epoch: stats.epoch,
    totalTransactions: stats.transactions,
    totalAccounts: stats.accounts,
    totalBlocks: stats.blocks,
    refreshRate: stats.refreshRate,
    averageTps,
    egldUsd: economics.price,
    marketCapUsd: economics.marketCap,
    minGasPrice: networkConfig.data.config.erd_min_gas_price,
    chainId: networkConfig.data.config.erd_chain_id,
    roundDurationMs: networkConfig.data.config.erd_round_duration,
    networkHealth: stats.refreshRate <= 6000 ? 'healthy' : 'degraded'
  };
}

export async function fetchRecentNetworkActivity(): Promise<ActivityItem[]> {
  const transactions = await fetchPublic<TransactionResponse>(
    `${CHAIN_STATUS_API_BASE}/transactions?size=10&status=success&order=desc`
  );

  return transactions.map((transaction) => {
    const type = transaction.function?.toLowerCase().includes('deploy')
      ? 'publish'
      : Number(transaction.value) > 0
        ? 'payment'
        : 'call';

    return {
      id: transaction.txHash,
      type,
      title:
        type === 'payment'
          ? 'EGLD settlement confirmed'
          : type === 'publish'
            ? 'Registry publish observed'
            : 'API-linked contract call observed',
      subtitle: transaction.function ?? `${transaction.sender.slice(0, 8)} -> ${transaction.receiver.slice(0, 8)}`,
      timestamp: new Date(transaction.timestamp * 1000).toISOString(),
      txHash: transaction.txHash,
      value: transaction.value
    };
  });
}

export async function fetchViewer() {
  return fetchInternal<ViewerResponse>('/v1/me', { method: 'GET' }, true);
}

export async function fetchUsageEvents() {
  const response = await fetchInternal<{ data: UsageEvent[] }>('/v1/usage/events', { method: 'GET' }, true);
  return response?.data ?? [];
}

export async function fetchUsageReceipt(receiptId: string) {
  return fetchInternal<UsageReceipt>(`/v1/usage/receipts/${receiptId}`, { method: 'GET' }, true);
}

export async function fetchProjects() {
  const response = await fetchInternal<{ data: BuyerProject[] }>('/v1/projects', { method: 'GET' }, true);
  return response?.data ?? [];
}

export async function createBuyerProject(input: { name: string }) {
  return fetchInternal<BuyerProject>('/v1/projects', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function fetchProjectDetail(projectId: string) {
  return fetchInternal<ProjectDetail>(`/v1/projects/${projectId}`, { method: 'GET' }, true);
}

export async function createProjectGrant(projectId: string, input: { productId: string }) {
  return fetchInternal(`/v1/projects/${projectId}/grants`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function fetchProjectApiKeys(projectId: string) {
  const response = await fetchInternal<{ data: ProjectApiKey[] }>(`/v1/projects/${projectId}/api-keys`, { method: 'GET' }, true);
  return response?.data ?? [];
}

export async function createProjectApiKey(projectId: string, input: { name: string }) {
  return fetchInternal<CreatedProjectApiKey>(`/v1/projects/${projectId}/api-keys`, {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function fetchProviderProducts() {
  const response = await fetchInternal<{ data: ProviderProduct[] }>('/v1/providers/me/products', { method: 'GET' }, true);
  return response?.data ?? [];
}

export async function fetchProviderProfile() {
  return fetchInternal<ProviderProfile>('/v1/providers/me', { method: 'GET' }, true);
}

export async function fetchProviderEarnings() {
  return fetchInternal<ProviderEarnings>('/v1/providers/me/earnings', { method: 'GET' }, true);
}

export async function prepareProviderClaim(input?: { amountAtomic?: string }) {
  return fetchInternal<PreparedProviderClaim>('/v1/providers/me/claim/prepare', {
    method: 'POST',
    body: JSON.stringify(input ?? {})
  });
}

export async function trackProviderClaim(input: { txHash: string; amountAtomic: string }) {
  return fetchInternal('/v1/providers/me/claim/track', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function refreshProviderClaimState() {
  return fetchInternal<ProviderClaimRefresh>('/v1/providers/me/claim/refresh', {
    method: 'POST'
  });
}

export async function fetchWalletAccount(address: string) {
  try {
    return await fetchPublic<WalletAccount>(`${WALLET_CHAIN_API_BASE}/accounts/${address}`);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return null;
    }

    throw error;
  }
}

export async function fetchWalletTransactions(address: string) {
  try {
    return await fetchPublic<WalletTransaction[]>(`${WALLET_CHAIN_API_BASE}/accounts/${address}/transactions?size=20&order=desc`);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      return [];
    }

    throw error;
  }
}

export async function fetchMirrorTransactions() {
  const response = await fetchInternal<{ data: MirrorTransaction[] }>('/v1/chain-transactions', { method: 'GET' }, true);
  return response?.data ?? [];
}

export async function createSessionWithNativeAuth(input: { nativeAuthToken: string; displayName?: string }) {
  return fetchInternal('/v1/auth/native-auth/login', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function logoutSession() {
  return fetchInternal('/v1/auth/logout', {
    method: 'POST'
  });
}

export async function submitProviderProduct(input: Record<string, unknown>) {
  return fetchInternal('/v1/providers/me/products', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function createProviderProfile(input: Record<string, unknown>) {
  return fetchInternal('/v1/providers', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function updateProviderProfile(input: Record<string, unknown>) {
  return fetchInternal('/v1/providers/me', {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export async function updateProviderProduct(productId: string, input: Record<string, unknown>) {
  return fetchInternal(`/v1/providers/me/products/${productId}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export async function fetchAdminProviders() {
  const response = await fetchInternal<{ data: AdminProviderRecord[] }>('/v1/admin/providers', { method: 'GET' }, true);
  return response?.data ?? [];
}

export async function fetchSettlementBatches() {
  const response = await fetchInternal<{ data: SettlementBatchRecord[] }>('/v1/admin/settlement-batches', { method: 'GET' }, true);
  return response?.data ?? [];
}

export async function refreshSettlementBatches() {
  return fetchInternal<SettlementRefreshResult>('/v1/admin/settlement-batches/refresh', {
    method: 'POST'
  });
}

export async function approveAdminProvider(providerId: string, notes?: string) {
  return fetchInternal(`/v1/admin/providers/${providerId}/approve`, {
    method: 'POST',
    body: JSON.stringify(notes ? { notes } : {})
  });
}

export async function rejectAdminProvider(providerId: string, notes?: string) {
  return fetchInternal(`/v1/admin/providers/${providerId}/reject`, {
    method: 'POST',
    body: JSON.stringify(notes ? { notes } : {})
  });
}

export async function activateAdminProduct(productId: string, notes?: string) {
  return fetchInternal(`/v1/admin/products/${productId}/activate`, {
    method: 'POST',
    body: JSON.stringify(notes ? { notes } : {})
  });
}

export async function pauseAdminProduct(productId: string, notes?: string) {
  return fetchInternal(`/v1/admin/products/${productId}/pause`, {
    method: 'POST',
    body: JSON.stringify(notes ? { notes } : {})
  });
}

export async function retrySettlementBatch(batchId: string) {
  return fetchInternal(`/v1/admin/settlement-batches/${batchId}/retry`, {
    method: 'POST'
  });
}

export async function submitProductForReview(productId: string) {
  return fetchInternal(`/v1/providers/me/products/${productId}/submit`, {
    method: 'POST'
  });
}

export async function executePlaygroundCall(productId: string, payload: Record<string, unknown>, apiKey: string) {
  const response = await fetch(`${getGatewayBaseUrl()}/v1/gateway/products/${productId}/call`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      'idempotency-key': `mx402-playground-${Date.now()}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const payload = await parseJson<{ error?: { message?: string } }>(response).catch(() => null);
    throw new HttpError(payload?.error?.message ?? `Gateway request failed: ${response.status}`, response.status);
  }

  return parseJson(response);
}

export { HttpError, getInternalApiBase };
