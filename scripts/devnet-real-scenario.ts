import { execSync } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { URL } from "node:url";

import { NativeAuthClient } from "@multiversx/sdk-native-auth-client";
import { Message, MessageComputer } from "@multiversx/sdk-dapp/out/lib/sdkCore.mjs";
import { UserSecretKey } from "@multiversx/sdk-core/out/wallet/userKeys";
import { UserSigner } from "@multiversx/sdk-core/out/wallet/userSigner";

import { buildApp } from "../apps/api/src/app.ts";
import { buildGatewayApp } from "../apps/gateway/src/app.ts";
import { claimProviderEarningsOnChain, createSignerSession, depositToLedgerOnChain, waitForTransactionFinality } from "../apps/worker/src/chain.ts";
import { confirmSubmittedProviderClaims } from "../apps/worker/src/claims.ts";
import { syncTrackedDeposits } from "../apps/worker/src/deposits.ts";
import { confirmSubmittedSettlementBatches, runSettlementCycle } from "../apps/worker/src/settlements.ts";
import { getPrismaClient } from "../packages/db/src/index.ts";
import { createLogger } from "../packages/observability/src/index.ts";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/mx402";
const API_PORT = Number(process.env.MX402_SCENARIO_API_PORT ?? "4510");
const GATEWAY_PORT = Number(process.env.MX402_SCENARIO_GATEWAY_PORT ?? "4520");
const MOCK_PROVIDER_PORT = Number(process.env.MX402_SCENARIO_PROVIDER_PORT ?? "4580");
const ORIGIN = process.env.MX402_SCENARIO_ORIGIN ?? `http://127.0.0.1:${API_PORT}`;
const SESSION_SECRET = process.env.MX402_SCENARIO_SESSION_SECRET ?? "mx402-devnet-scenario-secret";
const CHAIN_API_URL = process.env.MULTIVERSX_API_URL ?? "https://devnet-api.multiversx.com";
const CHAIN_GATEWAY_URL = process.env.MULTIVERSX_GATEWAY_URL ?? "https://devnet-gateway.multiversx.com";
const LEDGER_CONTRACT = process.env.MX402_LEDGER_CONTRACT ?? "";
const ASSET_IDENTIFIER = process.env.MX402_ASSET_IDENTIFIER ?? "EGLD";
const CHAIN_ID = process.env.MX402_CHAIN_ID ?? "D";
const DEPOSIT_ATOMIC = process.env.MX402_SCENARIO_DEPOSIT_ATOMIC ?? "20000000000000000";
const PRODUCT_PRICE_ATOMIC = process.env.MX402_SCENARIO_PRICE_ATOMIC ?? "1000000000000000";
const CALL_COUNT = Number(process.env.MX402_SCENARIO_CALL_COUNT ?? "1");

type NativeAuthIdentity = {
  address: string;
  nativeAuthToken: string;
};

type SessionResponse<T> = {
  status: number;
  data: T;
};

class CookieClient {
  private readonly baseUrl: string;
  private cookie: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async request<T>(path: string, init?: RequestInit): Promise<SessionResponse<T>> {
    const headers = new Headers(init?.headers ?? {});

    if (this.cookie) {
      headers.set("cookie", this.cookie);
    }

    if (init?.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers
    });

    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      this.cookie = setCookie.split(";")[0];
    }

    const rawBody = await response.text();
    const data = rawBody ? JSON.parse(rawBody) : null;

    if (!response.ok) {
      throw new Error(`Request failed ${response.status} ${path}: ${rawBody}`);
    }

    return {
      status: response.status,
      data: data as T
    };
  }
}

function respondJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
}

function getSigner(secretKeyHex: string) {
  const secretKey = UserSecretKey.fromString(secretKeyHex);
  const signer = new UserSigner(secretKey);

  return {
    signer,
    address: signer.getAddress().toBech32()
  };
}

async function createNativeAuthIdentity(secretKeyHex: string): Promise<NativeAuthIdentity> {
  const { signer, address } = getSigner(secretKeyHex);
  const client = new NativeAuthClient({
    origin: ORIGIN,
    apiUrl: CHAIN_API_URL,
    expirySeconds: 3600
  });
  const loginToken = await client.initialize({
    scenario: "mx402-devnet-real"
  });
  const message = new Message({
    address: signer.getAddress(),
    data: Buffer.from(`${address}${loginToken}`, "utf8")
  });
  const payload = new MessageComputer().computeBytesForSigning(message);
  const signature = Buffer.from(await signer.sign(payload)).toString("hex");

  return {
    address,
    nativeAuthToken: client.getToken(address, loginToken, signature)
  };
}

async function startMockProviderServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${MOCK_PROVIDER_PORT}`);

    if (request.method === "GET" && url.pathname.startsWith("/risk/")) {
      const address = decodeURIComponent(url.pathname.replace("/risk/", ""));
      return respondJson(response, 200, {
        score: 21,
        address,
        riskLevel: "low",
        source: "mx402-devnet-scenario"
      });
    }

    return respondJson(response, 404, {
      error: "not found"
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(MOCK_PROVIDER_PORT, "127.0.0.1", () => resolve());
  });

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

async function prepareDatabase() {
  execSync("npm run db:push --workspace @mx402/db", {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env
  });

  const prisma = getPrismaClient();

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      admin_audit_logs,
      chain_transactions,
      settlement_lines,
      settlement_batches,
      usage_receipts,
      usage_events,
      usage_reservations,
      gateway_idempotency_keys,
      project_api_keys,
      project_product_grants,
      buyer_projects,
      provider_products,
      provider_balances,
      providers,
      buyer_balances,
      wallet_sessions,
      users
    RESTART IDENTITY CASCADE;
  `);
}

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} for the real devnet scenario`);
  }

  return value;
}

async function main() {
  if (!LEDGER_CONTRACT) {
    throw new Error("MX402_LEDGER_CONTRACT must point to a deployed devnet ledger contract before running this scenario");
  }

  const adminSecret = process.env.MX402_SCENARIO_ADMIN_PRIVATE_KEY ?? requireEnv("MX402_OWNER_PRIVATE_KEY");
  const providerSecret = process.env.MX402_PROVIDER_PRIVATE_KEY ?? adminSecret;
  const buyerSecret = process.env.MX402_BUYER_PRIVATE_KEY ?? adminSecret;
  const settlementSecret = process.env.MX402_SETTLEMENT_PRIVATE_KEY ?? adminSecret;

  const adminWallet = getSigner(adminSecret);
  const providerWallet = getSigner(providerSecret);
  const buyerWallet = getSigner(buyerSecret);

  process.env.DATABASE_URL = DATABASE_URL;
  process.env.MX402_ENV = "development";
  process.env.MX402_ASSET_IDENTIFIER = ASSET_IDENTIFIER;
  process.env.MX402_CHAIN_ID = CHAIN_ID;
  process.env.MX402_LEDGER_CONTRACT = LEDGER_CONTRACT;
  process.env.SESSION_SIGNING_SECRET = SESSION_SECRET;
  process.env.MULTIVERSX_API_URL = CHAIN_API_URL;
  process.env.MULTIVERSX_GATEWAY_URL = CHAIN_GATEWAY_URL;
  process.env.NATIVE_AUTH_ALLOWED_ORIGINS = ORIGIN;
  process.env.NATIVE_AUTH_MAX_EXPIRY_SECONDS = "3600";
  process.env.MX402_BOOTSTRAP_ADMIN_WALLETS = adminWallet.address;
  process.env.GATEWAY_RESERVATION_TTL_SECONDS = "300";
  process.env.GATEWAY_RESPONSE_CACHE_TTL_SECONDS = "3600";
  process.env.MX402_SETTLEMENT_PRIVATE_KEY = settlementSecret;

  const logger = createLogger("devnet-scenario");
  const mockProvider = await startMockProviderServer();
  await prepareDatabase();

  const apiApp = buildApp();
  await apiApp.listen({
    host: "127.0.0.1",
    port: API_PORT
  });

  const gatewayApp = buildGatewayApp();
  await gatewayApp.listen({
    host: "127.0.0.1",
    port: GATEWAY_PORT
  });

  const adminIdentity = await createNativeAuthIdentity(adminSecret);
  const providerIdentity = await createNativeAuthIdentity(providerSecret);
  const buyerIdentity = await createNativeAuthIdentity(buyerSecret);
  console.log("[scenario] native auth identities ready");

  const adminClient = new CookieClient(`http://127.0.0.1:${API_PORT}`);
  const providerClient = new CookieClient(`http://127.0.0.1:${API_PORT}`);
  const buyerClient = new CookieClient(`http://127.0.0.1:${API_PORT}`);

  await adminClient.request("/v1/auth/native-auth/login", {
    method: "POST",
    body: JSON.stringify({
      nativeAuthToken: adminIdentity.nativeAuthToken,
      displayName: "Devnet Admin"
    })
  });

  await providerClient.request("/v1/auth/native-auth/login", {
    method: "POST",
    body: JSON.stringify({
      nativeAuthToken: providerIdentity.nativeAuthToken,
      displayName: "Devnet Provider"
    })
  });

  await buyerClient.request("/v1/auth/native-auth/login", {
    method: "POST",
    body: JSON.stringify({
      nativeAuthToken: buyerIdentity.nativeAuthToken,
      displayName: "Devnet Buyer"
    })
  });
  console.log("[scenario] api sessions established");

  const providerProfile = await providerClient.request<{ id: string }>("/v1/providers", {
    method: "POST",
    body: JSON.stringify({
      slug: "devnet-signal-labs",
      displayName: "Devnet Signal Labs",
      description: "Real devnet MX402 scenario provider",
      websiteUrl: "https://example.com/devnet-signal-labs",
      payoutWalletAddress: providerWallet.address
    })
  });
  console.log("[scenario] provider created", providerProfile.data.id);

  const product = await providerClient.request<{ id: string }>("/v1/providers/me/products", {
    method: "POST",
    body: JSON.stringify({
      slug: "devnet-wallet-risk-score",
      name: "Devnet Wallet Risk Score",
      shortDescription: "Live gateway scenario endpoint on devnet",
      description: "Returns a deterministic score from a local provider service while payments settle on MultiversX Devnet.",
      baseUrl: `http://127.0.0.1:${MOCK_PROVIDER_PORT}`,
      upstreamPathTemplate: "/risk/{address}",
      upstreamMethod: "GET",
      priceAtomic: PRODUCT_PRICE_ATOMIC,
      timeoutMs: 5000,
      rateLimitPerMinute: 120,
      originAuthMode: "none",
      pathParamsSchemaJson: {},
      inputSchemaJson: {},
      querySchemaJson: {},
      outputSchemaJson: {}
    })
  });
  console.log("[scenario] product created", product.data.id);

  await providerClient.request(`/v1/providers/me/products/${product.data.id}/submit`, {
    method: "POST"
  });
  console.log("[scenario] product submitted");

  await adminClient.request(`/v1/admin/providers/${providerProfile.data.id}/approve`, {
    method: "POST",
    body: JSON.stringify({
      notes: "Approved by real devnet scenario"
    })
  });
  console.log("[scenario] provider approved");

  await adminClient.request(`/v1/admin/products/${product.data.id}/activate`, {
    method: "POST",
    body: JSON.stringify({
      notes: "Activated by real devnet scenario"
    })
  });
  console.log("[scenario] product activated");

  const buyerSignerSession = await createSignerSession(buyerSecret);
  console.log("[scenario] buyer signer ready", buyerWallet.address);
  const depositTxHash = await depositToLedgerOnChain(buyerSignerSession, {
    contractAddress: LEDGER_CONTRACT,
    assetIdentifier: ASSET_IDENTIFIER,
    amountAtomic: DEPOSIT_ATOMIC
  });
  console.log("[scenario] deposit submitted", depositTxHash);
  const depositObserved = await waitForTransactionFinality({
    txHash: depositTxHash,
    timeoutMs: Number(process.env.MX402_SCENARIO_CHAIN_TIMEOUT_MS ?? "180000"),
    pollIntervalMs: Number(process.env.MX402_SCENARIO_CHAIN_POLL_MS ?? "6000")
  });
  console.log("[scenario] deposit confirmed", depositObserved.status);

  if (!["success", "executed"].includes(depositObserved.status.toLowerCase())) {
    throw new Error(`Deposit failed with status ${depositObserved.status}`);
  }

  await buyerClient.request("/v1/balance/deposits/track", {
    method: "POST",
    body: JSON.stringify({
      txHash: depositTxHash,
      amountAtomic: DEPOSIT_ATOMIC
    })
  });
  console.log("[scenario] deposit tracked");

  const depositSync = await syncTrackedDeposits(logger);
  console.log("[scenario] deposit sync", JSON.stringify(depositSync));
  const buyerBalanceAfterDeposit = await buyerClient.request<{ spendableAtomic: string }>("/v1/balance", {
    method: "GET"
  });
  console.log("[scenario] buyer balance after deposit", buyerBalanceAfterDeposit.data.spendableAtomic);

  const project = await buyerClient.request<{ id: string }>("/v1/projects", {
    method: "POST",
    body: JSON.stringify({
      name: "Devnet Buyer Project"
    })
  });
  console.log("[scenario] buyer project created", project.data.id);

  const apiKeyResponse = await buyerClient.request<{ apiKey: string }>(`/v1/projects/${project.data.id}/api-keys`, {
    method: "POST",
    body: JSON.stringify({
      name: "Devnet Scenario Key"
    })
  });
  console.log("[scenario] api key created");

  await buyerClient.request(`/v1/projects/${project.data.id}/grants`, {
    method: "POST",
    body: JSON.stringify({
      productId: product.data.id
    })
  });
  console.log("[scenario] product grant created");

  const settlementTxHashes: string[] = [];
  const claimTxHashes: string[] = [];
  const receiptIds: string[] = [];
  const receipts: unknown[] = [];
  let lastGatewayBody: Record<string, string> | null = null;
  let lastSettlementConfirmation: { confirmed: number; failed: number; pending: number } | null = null;
  let lastClaimConfirmation: { confirmed: number; failed: number; pending: number } | null = null;
  let lastProviderEarningsAfterSettlement:
    | {
        unsettledEarnedAtomic: string;
        claimableOnchainAtomic: string;
        claimedTotalAtomic: string;
      }
    | null = null;

  for (let index = 0; index < CALL_COUNT; index += 1) {
    const testNumber = index + 1;
    console.log(`[scenario] test ${testNumber}/${CALL_COUNT} starting`);

    const gatewayResponse = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/gateway/products/${product.data.id}/call`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKeyResponse.data.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": `devnet-scenario-${testNumber}-${Date.now()}`
      },
      body: JSON.stringify({
        pathParams: {
          address: buyerWallet.address
        },
        query: {},
        body: null
      })
    });

    const gatewayBody = await gatewayResponse.json();
    if (!gatewayResponse.ok) {
      throw new Error(`Gateway call failed on test ${testNumber}: ${JSON.stringify(gatewayBody)}`);
    }
    lastGatewayBody = gatewayBody as Record<string, string>;
    receiptIds.push(lastGatewayBody.receiptId);
    console.log("[scenario] gateway call succeeded", lastGatewayBody.receiptId);

    const settlementRun = await runSettlementCycle(logger);
    console.log("[scenario] settlement cycle", JSON.stringify(settlementRun));
    const settlementTxHash = settlementRun.submittedBatch?.txHash;
    if (!settlementTxHash) {
      throw new Error(`Settlement cycle did not submit a batch on test ${testNumber}`);
    }
    settlementTxHashes.push(settlementTxHash);

    const settlementObserved = await waitForTransactionFinality({
      txHash: settlementTxHash,
      timeoutMs: Number(process.env.MX402_SCENARIO_CHAIN_TIMEOUT_MS ?? "180000"),
      pollIntervalMs: Number(process.env.MX402_SCENARIO_CHAIN_POLL_MS ?? "6000")
    });
    console.log("[scenario] settlement confirmed", settlementObserved.status);

    if (!["success", "executed"].includes(settlementObserved.status.toLowerCase())) {
      throw new Error(`Settlement transaction failed on test ${testNumber} with status ${settlementObserved.status}`);
    }

    const settlementConfirmation = await confirmSubmittedSettlementBatches(logger);
    lastSettlementConfirmation = settlementConfirmation;
    console.log("[scenario] settlement confirmation", JSON.stringify(settlementConfirmation));
    const providerEarnings = await providerClient.request<{
      providerId: string;
      balances: {
        unsettledEarnedAtomic: string;
        claimableOnchainAtomic: string;
        claimedTotalAtomic: string;
      };
    }>("/v1/providers/me/earnings", {
      method: "GET"
    });
    lastProviderEarningsAfterSettlement = providerEarnings.data.balances;
    console.log("[scenario] provider earnings after settlement", JSON.stringify(providerEarnings.data.balances));

    const claimableAtomic = providerEarnings.data.balances.claimableOnchainAtomic;
    if (BigInt(claimableAtomic) <= 0n) {
      throw new Error(`Provider has no claimable on-chain balance after settlement on test ${testNumber}`);
    }

    const providerSignerSession = await createSignerSession(providerSecret);
    const claimTxHash = await claimProviderEarningsOnChain(providerSignerSession, {
      contractAddress: LEDGER_CONTRACT,
      providerId: providerProfile.data.id,
      amountAtomic: claimableAtomic
    });
    claimTxHashes.push(claimTxHash);
    console.log("[scenario] claim submitted", claimTxHash);
    const claimObserved = await waitForTransactionFinality({
      txHash: claimTxHash,
      timeoutMs: Number(process.env.MX402_SCENARIO_CHAIN_TIMEOUT_MS ?? "180000"),
      pollIntervalMs: Number(process.env.MX402_SCENARIO_CHAIN_POLL_MS ?? "6000")
    });
    console.log("[scenario] claim confirmed", claimObserved.status);

    if (!["success", "executed"].includes(claimObserved.status.toLowerCase())) {
      throw new Error(`Provider claim failed on test ${testNumber} with status ${claimObserved.status}`);
    }

    await providerClient.request("/v1/providers/me/claim/track", {
      method: "POST",
      body: JSON.stringify({
        txHash: claimTxHash,
        amountAtomic: claimableAtomic
      })
    });
    console.log("[scenario] claim tracked");

    const claimConfirmation = await confirmSubmittedProviderClaims(logger);
    lastClaimConfirmation = claimConfirmation;
    console.log("[scenario] claim confirmation", JSON.stringify(claimConfirmation));

    const receipt = await buyerClient.request(`/v1/usage/receipts/${lastGatewayBody.receiptId}`, {
      method: "GET"
    });
    receipts.push(receipt.data);
    console.log(`[scenario] test ${testNumber}/${CALL_COUNT} completed`);
  }

  const providerEarningsAfterClaim = await providerClient.request<{
    balances: {
      unsettledEarnedAtomic: string;
      claimableOnchainAtomic: string;
      claimedTotalAtomic: string;
    };
  }>("/v1/providers/me/earnings", {
    method: "GET"
  });

  console.log(JSON.stringify({
    contractAddress: LEDGER_CONTRACT,
    assetIdentifier: ASSET_IDENTIFIER,
    testsRun: CALL_COUNT,
    adminWallet: adminWallet.address,
    providerWallet: providerWallet.address,
    buyerWallet: buyerWallet.address,
    depositTxHash,
    settlementTxHashes,
    claimTxHashes,
    providerId: providerProfile.data.id,
    productId: product.data.id,
    receiptIds,
    buyerBalanceAfterDeposit: buyerBalanceAfterDeposit.data.spendableAtomic,
    gatewayChargedAtomic: lastGatewayBody?.chargedAtomic ?? null,
    gatewayBalanceRemainingAtomic: lastGatewayBody?.balanceRemainingAtomic ?? null,
    providerBalancesAfterSettlement: lastProviderEarningsAfterSettlement,
    providerBalancesAfterClaim: providerEarningsAfterClaim.data.balances,
    depositSync,
    settlementConfirmation: lastSettlementConfirmation,
    claimConfirmation: lastClaimConfirmation,
    receipts
  }, null, 2));

  await apiApp.close();
  await gatewayApp.close();
  await mockProvider.close();
  await getPrismaClient().$disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await getPrismaClient().$disconnect().catch(() => undefined);
  process.exit(1);
});
