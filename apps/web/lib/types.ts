export type MarketplaceProduct = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  description?: string | null;
  priceAtomic: string;
  assetIdentifier: string | null;
  baseUrl?: string;
  upstreamMethod: 'GET' | 'POST';
  provider: {
    id: string;
    slug: string;
    displayName: string;
  };
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ProductDetail = MarketplaceProduct & {
  upstreamPathTemplate: string;
  timeoutMs: number;
  rateLimitPerMinute: number;
};

export type ChainOverview = {
  epoch: number;
  totalTransactions: number;
  totalAccounts: number;
  totalBlocks: number;
  refreshRate: number;
  averageTps: number;
  egldUsd: number;
  marketCapUsd: number;
  minGasPrice: string;
  chainId: string;
  roundDurationMs: number;
  networkHealth: 'healthy' | 'degraded';
};

export type ActivityItem = {
  id: string;
  type: 'payment' | 'publish' | 'call';
  title: string;
  subtitle: string;
  timestamp: string;
  txHash: string;
  value: string;
};

export type BuyerBalance = {
  assetIdentifier: string;
  onchainConfirmedAtomic: string;
  reservedAtomic: string;
  consumedUnsettledAtomic: string;
  spendableAtomic: string;
};

export type UserSummary = {
  id: string;
  walletAddress: string;
  displayName: string | null;
  isAdmin: boolean;
};

export type ProviderSummary = {
  id: string;
  slug: string;
  status: string;
  displayName: string;
} | null;

export type ViewerResponse = {
  user: UserSummary;
  provider: ProviderSummary;
  balance: BuyerBalance | null;
} | null;

export type UsageEvent = {
  id: string;
  requestStatus: string;
  charged: boolean;
  amountAtomic: string;
  providerStatusCode: number | null;
  latencyMs: number | null;
  product: {
    id: string;
    slug: string;
    name: string;
    providerName: string;
  };
  receiptId: string | null;
  occurredAt: string;
};

export type BuyerProject = {
  id: string;
  name: string;
  status: string;
  apiKeyCount: number;
  grantCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ProviderProduct = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  description: string | null;
  baseUrl: string;
  upstreamPathTemplate: string;
  upstreamMethod: 'GET' | 'POST';
  priceAtomic: string;
  timeoutMs: number;
  rateLimitPerMinute: number;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ProviderEarnings = {
  providerId: string;
  status: string;
  balances: {
    unsettledEarnedAtomic: string;
    claimableOnchainAtomic: string;
    claimedTotalAtomic: string;
  };
  recentUsage: Array<{
    id: string;
    productId: string;
    requestStatus: string;
    charged: boolean;
    amountAtomic: string;
    occurredAt: string;
  }>;
};

export type WalletAccount = {
  address: string;
  nonce: number;
  balance: string;
  username?: string;
  shard?: number;
};

export type WalletTransaction = {
  txHash: string;
  sender: string;
  receiver: string;
  value: string;
  status: string;
  timestamp: number;
  function?: string;
};

export type MirrorTransaction = {
  txHash: string;
  txKind: string;
  status: string;
  walletAddress: string;
  amountAtomic: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WalletConnection = {
  address: string | null;
  providerType: string | null;
  nativeAuthToken: string | null;
  networkAccountMissing?: boolean;
  warningMessage?: string | null;
};
