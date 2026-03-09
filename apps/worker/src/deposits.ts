import { Prisma, getPrismaClient } from "@mx402/db";
import { buildChainReadHeaders, loadChainReadRuntimeConfig, loadSharedRuntimeConfig, requireEnv } from "@mx402/config";
import type { Logger } from "@mx402/observability";

type TransactionRecord = {
  txHash?: string;
  sender?: string;
  receiver?: string;
  status?: string;
  value?: string;
  data?: string;
  function?: string;
  tokens?: string[];
  esdtValues?: string[];
  timestamp?: number;
};

type DepositInterpretation =
  | {
      kind: "pending";
    }
  | {
      kind: "failed";
      reason: string;
    }
  | {
      kind: "confirmed";
      walletAddress: string;
      amountAtomic: string;
      confirmedAt: Date;
      rawData: string;
    };

export type DepositSyncResult = {
  scanned: number;
  confirmed: number;
  failed: number;
  pending: number;
  skipped: number;
};

function isMostlyPrintable(value: string): boolean {
  return /^[\x20-\x7e]+$/.test(value);
}

function decodeMaybeBase64(value: string | undefined): string {
  if (!value) {
    return "";
  }

  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (decoded && isMostlyPrintable(decoded)) {
      return decoded;
    }
  } catch {
    return value;
  }

  return value;
}

function decodeHexToUtf8(value: string | undefined): string {
  if (!value) {
    return "";
  }

  try {
    return Buffer.from(value, "hex").toString("utf8").replace(/\0/g, "");
  } catch {
    return "";
  }
}

function hexToAtomicString(value: string | undefined): string {
  if (!value) {
    return "0";
  }

  return BigInt(`0x${value}`).toString();
}

function normalizeTransactionPayload(payload: unknown): TransactionRecord | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const root = payload as Record<string, unknown>;
  const transaction = (root.data as Record<string, unknown> | undefined)?.transaction ?? root.transaction ?? root;
  if (!transaction || typeof transaction !== "object") {
    return null;
  }

  const value = transaction as Record<string, unknown>;

  return {
    txHash: typeof value.txHash === "string" ? value.txHash : typeof value.hash === "string" ? value.hash : undefined,
    sender: typeof value.sender === "string" ? value.sender : undefined,
    receiver: typeof value.receiver === "string" ? value.receiver : undefined,
    status: typeof value.status === "string" ? value.status : undefined,
    value: typeof value.value === "string" ? value.value : undefined,
    data: typeof value.data === "string" ? value.data : undefined,
    function: typeof value.function === "string" ? value.function : undefined,
    tokens: Array.isArray(value.tokens) ? value.tokens.filter((item): item is string => typeof item === "string") : undefined,
    esdtValues: Array.isArray(value.esdtValues) ? value.esdtValues.filter((item): item is string => typeof item === "string") : undefined,
    timestamp: typeof value.timestamp === "number" ? value.timestamp : undefined
  };
}

function interpretDeposit(transaction: TransactionRecord, input: {
  assetIdentifier: string;
  contractAddress: string;
}): DepositInterpretation {
  const status = transaction.status?.toLowerCase() ?? "";
  if (status === "pending" || status === "received" || status === "queued") {
    return { kind: "pending" };
  }

  if (status && status !== "success" && status !== "executed") {
    return {
      kind: "failed",
      reason: `Transaction status is ${status}`
    };
  }

  if (!transaction.sender || !transaction.receiver) {
    return {
      kind: "failed",
      reason: "Transaction is missing sender or receiver"
    };
  }

  if (transaction.receiver !== input.contractAddress) {
    return {
      kind: "failed",
      reason: "Transaction receiver does not match the MX402 ledger contract"
    };
  }

  const rawData = decodeMaybeBase64(transaction.data);
  const resolvedFunction = transaction.function ?? rawData.split("@")[0] ?? "";
  const timestamp = transaction.timestamp ? new Date(transaction.timestamp * 1000) : new Date();

  if ((resolvedFunction === "deposit" || rawData.startsWith("deposit")) && input.assetIdentifier === "EGLD") {
    const amountAtomic = BigInt(transaction.value ?? "0").toString();
    if (amountAtomic === "0") {
      return {
        kind: "failed",
        reason: "EGLD deposit transaction has zero value"
      };
    }

    return {
      kind: "confirmed",
      walletAddress: transaction.sender,
      amountAtomic,
      confirmedAt: timestamp,
      rawData
    };
  }

  if (rawData.startsWith("ESDTTransfer@")) {
    const [, tokenHex, amountHex, endpointHex] = rawData.split("@");
    const tokenIdentifier = decodeHexToUtf8(tokenHex);
    const endpoint = decodeHexToUtf8(endpointHex);

    if (endpoint !== "deposit") {
      return {
        kind: "failed",
        reason: `Unsupported ESDT transfer endpoint: ${endpoint || "unknown"}`
      };
    }

    if (tokenIdentifier !== input.assetIdentifier) {
      return {
        kind: "failed",
        reason: `Unsupported deposit asset: ${tokenIdentifier}`
      };
    }

    return {
      kind: "confirmed",
      walletAddress: transaction.sender,
      amountAtomic: hexToAtomicString(amountHex),
      confirmedAt: timestamp,
      rawData
    };
  }

  if (resolvedFunction === "deposit" && transaction.tokens?.[0] === input.assetIdentifier && transaction.esdtValues?.[0]) {
    return {
      kind: "confirmed",
      walletAddress: transaction.sender,
      amountAtomic: BigInt(transaction.esdtValues[0]).toString(),
      confirmedAt: timestamp,
      rawData
    };
  }

  return {
    kind: "failed",
    reason: "Transaction does not match a supported deposit pattern"
  };
}

async function fetchTransaction(txHash: string) {
  const { apiUrl, gatewayUrl } = loadChainReadRuntimeConfig();
  const candidates = Array.from(new Set([
    `${gatewayUrl}/transaction/${txHash}?withResults=true`,
    `${gatewayUrl}/transactions/${txHash}?withResults=true`,
    `${apiUrl}/transactions/${txHash}?withResults=true`,
    `${apiUrl}/transaction/${txHash}?withResults=true`
  ]));
  const failures: string[] = [];

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        headers: buildChainReadHeaders()
      });

      if (response.ok) {
        return response.json();
      }

      failures.push(`${candidate} -> HTTP ${response.status}`);
    } catch (error) {
      failures.push(`${candidate} -> ${error instanceof Error ? error.message : "fetch failed"}`);
    }
  }

  throw new Error(`Failed to fetch transaction ${txHash} from configured MultiversX endpoint: ${failures.join("; ")}`);
}

async function applyConfirmedDeposit(input: {
  txHash: string;
  walletAddress: string;
  amountAtomic: string;
  confirmedAt: Date;
  rawPayload: unknown;
  logger: Logger;
}) {
  const prisma = getPrismaClient();
  const runtimeConfig = loadSharedRuntimeConfig();
  const amount = new Prisma.Decimal(input.amountAtomic);

  await prisma.$transaction(async (transactionDb) => {
    const existing = await transactionDb.chainTransaction.findUnique({
      where: {
        tx_hash: input.txHash
      }
    });

    if (existing?.status === "confirmed") {
      return;
    }

    const user = existing?.related_user_id
      ? await transactionDb.user.findUnique({
          where: {
            id: existing.related_user_id
          }
        })
      : null;

    const resolvedUser = user ?? await transactionDb.user.upsert({
      where: {
        wallet_address: input.walletAddress
      },
      update: {},
      create: {
        wallet_address: input.walletAddress
      }
    });

    await transactionDb.buyerBalance.upsert({
      where: {
        user_id: resolvedUser.id
      },
      update: {
        asset_identifier: runtimeConfig.assetIdentifier,
        onchain_confirmed_atomic: {
          increment: amount
        }
      },
      create: {
        user_id: resolvedUser.id,
        asset_identifier: runtimeConfig.assetIdentifier,
        onchain_confirmed_atomic: amount
      }
    });

    await transactionDb.chainTransaction.upsert({
      where: {
        tx_hash: input.txHash
      },
      update: {
        tx_kind: "deposit",
        status: "confirmed",
        wallet_address: input.walletAddress,
        related_user_id: resolvedUser.id,
        amount_atomic: amount,
        confirmed_at: input.confirmedAt,
        raw_response_json: input.rawPayload as Prisma.InputJsonValue
      },
      create: {
        tx_hash: input.txHash,
        tx_kind: "deposit",
        status: "confirmed",
        wallet_address: input.walletAddress,
        related_user_id: resolvedUser.id,
        amount_atomic: amount,
        confirmed_at: input.confirmedAt,
        raw_response_json: input.rawPayload as Prisma.InputJsonValue
      }
    });
  });

  input.logger.info("Indexed confirmed deposit", {
    txHash: input.txHash,
    walletAddress: input.walletAddress,
    amountAtomic: input.amountAtomic
  });
}

async function applyFailedDeposit(input: {
  txHash: string;
  walletAddress: string;
  rawPayload: unknown;
  logger: Logger;
  reason: string;
}) {
  const prisma = getPrismaClient();

  await prisma.chainTransaction.upsert({
    where: {
      tx_hash: input.txHash
    },
    update: {
      tx_kind: "deposit",
      status: "failed",
      wallet_address: input.walletAddress,
      raw_response_json: {
        reason: input.reason,
        payload: input.rawPayload
      } as Prisma.InputJsonValue
    },
    create: {
      tx_hash: input.txHash,
      tx_kind: "deposit",
      status: "failed",
      wallet_address: input.walletAddress,
      raw_response_json: {
        reason: input.reason,
        payload: input.rawPayload
      } as Prisma.InputJsonValue
    }
  });

  input.logger.warn("Marked tracked deposit as failed", {
    txHash: input.txHash,
    walletAddress: input.walletAddress,
    reason: input.reason
  });
}

export async function syncTrackedDeposits(logger: Logger): Promise<DepositSyncResult> {
  const prisma = getPrismaClient();
  const runtimeConfig = loadSharedRuntimeConfig();
  const contractAddress = requireEnv("MX402_LEDGER_CONTRACT");

  const pendingTransactions = await prisma.chainTransaction.findMany({
    where: {
      tx_kind: "deposit",
      status: "submitted"
    },
    orderBy: {
      created_at: "asc"
    },
    take: 100
  });

  const result: DepositSyncResult = {
    scanned: pendingTransactions.length,
    confirmed: 0,
    failed: 0,
    pending: 0,
    skipped: 0
  };

  for (const trackedTransaction of pendingTransactions) {
    try {
      const rawPayload = await fetchTransaction(trackedTransaction.tx_hash);
      const transaction = normalizeTransactionPayload(rawPayload);

      if (!transaction) {
        result.failed += 1;
        await applyFailedDeposit({
          txHash: trackedTransaction.tx_hash,
          walletAddress: trackedTransaction.wallet_address,
          rawPayload,
          logger,
          reason: "Unable to normalize transaction payload"
        });
        continue;
      }

      const interpretation = interpretDeposit(transaction, {
        assetIdentifier: runtimeConfig.assetIdentifier,
        contractAddress
      });

      if (interpretation.kind === "pending") {
        result.pending += 1;
        continue;
      }

      if (interpretation.kind === "failed") {
        result.failed += 1;
        await applyFailedDeposit({
          txHash: trackedTransaction.tx_hash,
          walletAddress: transaction.sender ?? trackedTransaction.wallet_address,
          rawPayload,
          logger,
          reason: interpretation.reason
        });
        continue;
      }

      await applyConfirmedDeposit({
        txHash: trackedTransaction.tx_hash,
        walletAddress: interpretation.walletAddress,
        amountAtomic: interpretation.amountAtomic,
        confirmedAt: interpretation.confirmedAt,
        rawPayload,
        logger
      });
      result.confirmed += 1;
    } catch (error) {
      result.skipped += 1;
      logger.error("Deposit sync attempt failed", {
        txHash: trackedTransaction.tx_hash,
        message: error instanceof Error ? error.message : "Unexpected error"
      });
    }
  }

  return result;
}
