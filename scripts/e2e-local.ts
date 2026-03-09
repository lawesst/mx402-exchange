import { execSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";

import { NativeAuthClient } from "@multiversx/sdk-native-auth-client";
import { Message, MessageComputer } from "@multiversx/sdk-dapp/out/lib/sdkCore.mjs";
import { UserSecretKey } from "@multiversx/sdk-core/out/wallet/userKeys";
import { UserSigner } from "@multiversx/sdk-core/out/wallet/userSigner";

import { buildApp } from "../apps/api/src/app.ts";
import { buildGatewayApp } from "../apps/gateway/src/app.ts";
import { syncTrackedDeposits } from "../apps/worker/src/deposits.ts";
import { getPrismaClient } from "../packages/db/src/index.ts";
import { createLogger } from "../packages/observability/src/index.ts";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/mx402";
const API_PORT = 4110;
const GATEWAY_PORT = 4120;
const MOCK_CHAIN_PORT = 4210;
const MOCK_PROVIDER_PORT = 4180;
const MOCK_ORIGIN = "http://local-e2e";
const ASSET_IDENTIFIER = "TEST-123456";
const CHAIN_ID = "D";
const SESSION_SECRET = "mx402-e2e-secret";
const ADMIN_SECRET = "1111111111111111111111111111111111111111111111111111111111111111";
const PROVIDER_SECRET = "2222222222222222222222222222222222222222222222222222222222222222";
const BUYER_SECRET = "3333333333333333333333333333333333333333333333333333333333333333";
const LEDGER_SECRET = "4444444444444444444444444444444444444444444444444444444444444444";

type NativeAuthIdentity = {
  address: string;
  nativeAuthToken: string;
};

type SessionResponse<T> = {
  status: number;
  data: T;
  headers: Headers;
};

type MockTransactionFixture = {
  sender: string;
  receiver: string;
  status: string;
  data: string;
  timestamp: number;
};

class CookieClient {
  baseUrl: string;
  cookie: string | null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.cookie = null;
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
      data: data as T,
      headers: response.headers
    };
  }
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
    origin: MOCK_ORIGIN,
    apiUrl: `http://127.0.0.1:${MOCK_CHAIN_PORT}`,
    expirySeconds: 3600
  });
  const loginToken = await client.initialize({
    scenario: "mx402-local-e2e"
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

function respondJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
}

async function startMockChainServer(fixtures: Map<string, MockTransactionFixture>) {
  const latestBlockHash = "e2e-block-hash";
  const latestTimestamp = Math.floor(Date.now() / 1000);

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${MOCK_CHAIN_PORT}`);

    if (url.pathname === "/blocks/latest") {
      return respondJson(response, 200, [{ hash: latestBlockHash }]);
    }

    if (url.pathname === "/blocks" && url.searchParams.get("fields") === "hash") {
      return respondJson(response, 200, [{ hash: latestBlockHash }]);
    }

    if (url.pathname === "/blocks" && url.searchParams.get("fields") === "timestamp") {
      return respondJson(response, 200, [{ timestamp: latestTimestamp }]);
    }

    if (url.pathname === `/blocks/${latestBlockHash}` && url.searchParams.get("extract") === "timestamp") {
      return respondJson(response, 200, latestTimestamp);
    }

    if (url.pathname.startsWith("/transaction/") || url.pathname.startsWith("/transactions/")) {
      const txHash = url.pathname.split("/").pop() ?? "";
      const fixture = fixtures.get(txHash);

      if (!fixture) {
        return respondJson(response, 404, {
          error: "not found"
        });
      }

      return respondJson(response, 200, {
        txHash,
        sender: fixture.sender,
        receiver: fixture.receiver,
        status: fixture.status,
        data: fixture.data,
        timestamp: fixture.timestamp
      });
    }

    return respondJson(response, 404, {
      error: "not found"
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(MOCK_CHAIN_PORT, "127.0.0.1", () => resolve());
  });

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

async function startMockProviderServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${MOCK_PROVIDER_PORT}`);

    if (request.method === "GET" && url.pathname.startsWith("/risk/")) {
      const address = decodeURIComponent(url.pathname.replace("/risk/", ""));
      return respondJson(response, 200, {
        score: 17,
        address,
        riskLevel: "low"
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

async function main() {
  const admin = getSigner(ADMIN_SECRET);
  const providerWallet = getSigner(PROVIDER_SECRET);
  const buyerWallet = getSigner(BUYER_SECRET);
  const ledgerWallet = getSigner(LEDGER_SECRET);

  process.env.DATABASE_URL = DATABASE_URL;
  process.env.MX402_ENV = "development";
  process.env.MX402_ASSET_IDENTIFIER = ASSET_IDENTIFIER;
  process.env.MX402_CHAIN_ID = CHAIN_ID;
  process.env.MX402_LEDGER_CONTRACT = ledgerWallet.address;
  process.env.SESSION_SIGNING_SECRET = SESSION_SECRET;
  process.env.MULTIVERSX_API_URL = `http://127.0.0.1:${MOCK_CHAIN_PORT}`;
  process.env.MULTIVERSX_GATEWAY_URL = `http://127.0.0.1:${MOCK_CHAIN_PORT}`;
  process.env.NATIVE_AUTH_ALLOWED_ORIGINS = MOCK_ORIGIN;
  process.env.NATIVE_AUTH_MAX_EXPIRY_SECONDS = "3600";
  process.env.MX402_BOOTSTRAP_ADMIN_WALLETS = admin.address;
  process.env.GATEWAY_RESERVATION_TTL_SECONDS = "300";
  process.env.GATEWAY_RESPONSE_CACHE_TTL_SECONDS = "3600";

  const txFixtures = new Map<string, MockTransactionFixture>();
  const mockChain = await startMockChainServer(txFixtures);
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

  const logger = createLogger("e2e");
  const adminIdentity = await createNativeAuthIdentity(ADMIN_SECRET);
  const providerIdentity = await createNativeAuthIdentity(PROVIDER_SECRET);
  const buyerIdentity = await createNativeAuthIdentity(BUYER_SECRET);

  const adminClient = new CookieClient(`http://127.0.0.1:${API_PORT}`);
  const providerClient = new CookieClient(`http://127.0.0.1:${API_PORT}`);
  const buyerClient = new CookieClient(`http://127.0.0.1:${API_PORT}`);

  await adminClient.request("/v1/auth/native-auth/login", {
    method: "POST",
    body: JSON.stringify({
      nativeAuthToken: adminIdentity.nativeAuthToken,
      displayName: "Admin"
    })
  });

  await providerClient.request("/v1/auth/native-auth/login", {
    method: "POST",
    body: JSON.stringify({
      nativeAuthToken: providerIdentity.nativeAuthToken,
      displayName: "Provider"
    })
  });

  await buyerClient.request("/v1/auth/native-auth/login", {
    method: "POST",
    body: JSON.stringify({
      nativeAuthToken: buyerIdentity.nativeAuthToken,
      displayName: "Buyer"
    })
  });

  const providerProfile = await providerClient.request<{ id: string }>("/v1/providers", {
    method: "POST",
    body: JSON.stringify({
      slug: "signal-labs",
      displayName: "Signal Labs",
      description: "Mock provider for MX402 local e2e",
      websiteUrl: "https://signal.example",
      payoutWalletAddress: providerWallet.address
    })
  });

  const product = await providerClient.request<{ id: string }>("/v1/providers/me/products", {
    method: "POST",
    body: JSON.stringify({
      slug: "wallet-risk-score",
      name: "Wallet Risk Score",
      shortDescription: "Mock wallet risk score endpoint",
      description: "Returns a deterministic score from a mock provider service",
      baseUrl: `http://127.0.0.1:${MOCK_PROVIDER_PORT}`,
      upstreamPathTemplate: "/risk/{address}",
      upstreamMethod: "GET",
      priceAtomic: "1000",
      timeoutMs: 5000,
      rateLimitPerMinute: 120,
      originAuthMode: "none",
      pathParamsSchemaJson: {},
      inputSchemaJson: {},
      querySchemaJson: {},
      outputSchemaJson: {}
    })
  });

  await providerClient.request(`/v1/providers/me/products/${product.data.id}/submit`, {
    method: "POST"
  });

  await adminClient.request(`/v1/admin/providers/${providerProfile.data.id}/approve`, {
    method: "POST",
    body: JSON.stringify({
      notes: "Approved by local e2e scenario"
    })
  });

  await adminClient.request(`/v1/admin/products/${product.data.id}/activate`, {
    method: "POST",
    body: JSON.stringify({
      notes: "Activated by local e2e scenario"
    })
  });

  const depositPrepare = await buyerClient.request<{ amountAtomic: string }>("/v1/balance/deposit/prepare", {
    method: "POST",
    body: JSON.stringify({
      amountAtomic: "5000"
    })
  });

  const depositTxHash = "deposittx1234567890";
  const tokenHex = Buffer.from(ASSET_IDENTIFIER, "utf8").toString("hex");
  const amountHex = BigInt(depositPrepare.data.amountAtomic).toString(16).padStart(2, "0");
  const endpointHex = Buffer.from("deposit", "utf8").toString("hex");

  txFixtures.set(depositTxHash, {
    sender: buyerWallet.address,
    receiver: ledgerWallet.address,
    status: "success",
    data: `ESDTTransfer@${tokenHex}@${amountHex}@${endpointHex}`,
    timestamp: Math.floor(Date.now() / 1000)
  });

  await buyerClient.request("/v1/balance/deposits/track", {
    method: "POST",
    body: JSON.stringify({
      txHash: depositTxHash,
      amountAtomic: depositPrepare.data.amountAtomic
    })
  });

  const chainPreflight = await fetch(`http://127.0.0.1:${MOCK_CHAIN_PORT}/transaction/${depositTxHash}?withResults=true`, {
    headers: {
      accept: "application/json"
    }
  });

  if (!chainPreflight.ok) {
    throw new Error(`Mock chain preflight failed with ${chainPreflight.status}`);
  }

  const syncResult = await syncTrackedDeposits(logger);

  const buyerBalance = await buyerClient.request<{ spendableAtomic: string }>("/v1/balance", {
    method: "GET"
  });

  const project = await buyerClient.request<{ id: string }>("/v1/projects", {
    method: "POST",
    body: JSON.stringify({
      name: "Local E2E Buyer Project"
    })
  });

  const apiKeyResponse = await buyerClient.request<{ apiKey: string }>("/v1/projects/" + project.data.id + "/api-keys", {
    method: "POST",
    body: JSON.stringify({
      name: "Local E2E Key"
    })
  });

  await buyerClient.request("/v1/projects/" + project.data.id + "/grants", {
    method: "POST",
    body: JSON.stringify({
      productId: product.data.id
    })
  });

  const gatewayResponse = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/v1/gateway/products/${product.data.id}/call`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKeyResponse.data.apiKey}`,
      "content-type": "application/json",
      "idempotency-key": "local-e2e-request-1"
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
    throw new Error(`Gateway call failed: ${JSON.stringify(gatewayBody)}`);
  }

  const receiptId = gatewayBody.receiptId as string;
  const receipt = await buyerClient.request(`/v1/usage/receipts/${receiptId}`, {
    method: "GET"
  });

  console.log("");
  console.log("MX402 local e2e scenario completed");
  console.log(JSON.stringify({
    adminWallet: admin.address,
    providerWallet: providerWallet.address,
    buyerWallet: buyerWallet.address,
    providerId: providerProfile.data.id,
    productId: product.data.id,
    projectId: project.data.id,
    receiptId,
    buyerBalanceAfterDeposit: buyerBalance.data.spendableAtomic,
    depositSync: syncResult,
    gatewayChargedAtomic: gatewayBody.chargedAtomic,
    gatewayBalanceRemainingAtomic: gatewayBody.balanceRemainingAtomic,
    receipt
  }, null, 2));

  await apiApp.close();
  await gatewayApp.close();
  await mockChain.close();
  await mockProvider.close();
  await getPrismaClient().$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await getPrismaClient().$disconnect().catch(() => undefined);
  process.exit(1);
});
