import { randomUUID } from "node:crypto";

import { Prisma, getPrismaClient } from "@mx402/db";
import { optionalEnv } from "@mx402/config";
import type { Logger } from "@mx402/observability";

import {
  applySettlementBatchOnChain,
  contractHasProvider,
  createSignerSession,
  getContractFeeBps,
  getContractProviderPayoutAddress,
  getSharedChainConfig,
  getTransactionStatus,
  isFailureStatus,
  isSuccessfulStatus,
  registerProviderOnChain,
  requireSettlementSecretKey,
  requireSharedChainConfig,
  type SettlementBuyerDebit,
  type SettlementProviderCredit,
  updateProviderPayoutOnChain,
  waitForTransactionFinality
} from "./chain.js";

type CreatedBatch = {
  id: string;
  batchId: string;
  feeBps: number;
  eventCount: number;
  totalBuyerDebitsAtomic: string;
  totalProviderCreditsAtomic: string;
  platformFeeAtomic: string;
};

function decimalToBigInt(value: Prisma.Decimal | string | number) {
  return BigInt(value.toString());
}

function toDecimal(value: bigint) {
  return new Prisma.Decimal(value.toString());
}

function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

function computeFee(amountAtomic: bigint, feeBps: number) {
  return (amountAtomic * BigInt(feeBps)) / 10_000n;
}

function buildBatchId() {
  const stamp = new Date().toISOString().replace(/[^\d]/g, "").slice(0, 14);
  return `mx402-${stamp}-${randomUUID().slice(0, 8)}`;
}

async function resolveSettlementFeeBps(contractAddress: string | null) {
  if (contractAddress) {
    try {
      return await getContractFeeBps({
        contractAddress
      });
    } catch (error) {
      const fallback = optionalEnv("MX402_LEDGER_FEE_BPS", "");
      if (fallback) {
        return Number(fallback);
      }

      throw error;
    }
  }

  const fallback = optionalEnv("MX402_LEDGER_FEE_BPS", "0");
  return Number(fallback);
}

export async function createSettlementBatch(logger: Logger): Promise<CreatedBatch | null> {
  const prisma = getPrismaClient();
  const sharedConfig = getSharedChainConfig();
  const maxEvents = Number(optionalEnv("WORKER_SETTLEMENT_MAX_EVENTS", "250"));
  const feeBps = await resolveSettlementFeeBps(sharedConfig.contractAddress || null);

  return prisma.$transaction(async (tx) => {
    const blockingBatch = await tx.settlementBatch.findFirst({
      where: {
        status: {
          in: ["prepared", "submitted"]
        }
      },
      orderBy: {
        created_at: "asc"
      }
    });

    if (blockingBatch) {
      return null;
    }

    const events = await tx.usageEvent.findMany({
      where: {
        charged: true,
        settled_in_batch_id: null
      },
      orderBy: {
        occurred_at: "asc"
      },
      take: maxEvents,
      include: {
        buyer: {
          select: {
            wallet_address: true
          }
        }
      }
    });

    if (events.length === 0) {
      return null;
    }

    const buyerDebits = new Map<string, { walletAddress: string; amountAtomic: bigint; eventCount: number }>();
    const providerGross = new Map<string, { amountAtomic: bigint; eventCount: number }>();
    const providerCredits = new Map<string, { amountAtomic: bigint; eventCount: number }>();
    let totalBuyerDebitsAtomic = 0n;
    let totalProviderCreditsAtomic = 0n;
    let platformFeeAtomic = 0n;

    for (const event of events) {
      const amountAtomic = decimalToBigInt(event.amount_atomic);
      const feeAtomic = computeFee(amountAtomic, feeBps);
      const providerCreditAtomic = amountAtomic - feeAtomic;

      totalBuyerDebitsAtomic += amountAtomic;
      totalProviderCreditsAtomic += providerCreditAtomic;
      platformFeeAtomic += feeAtomic;

      const existingBuyer = buyerDebits.get(event.buyer_user_id) ?? {
        walletAddress: event.buyer.wallet_address,
        amountAtomic: 0n,
        eventCount: 0
      };
      existingBuyer.amountAtomic += amountAtomic;
      existingBuyer.eventCount += 1;
      buyerDebits.set(event.buyer_user_id, existingBuyer);

      const existingProviderGross = providerGross.get(event.provider_id) ?? {
        amountAtomic: 0n,
        eventCount: 0
      };
      existingProviderGross.amountAtomic += amountAtomic;
      existingProviderGross.eventCount += 1;
      providerGross.set(event.provider_id, existingProviderGross);

      const existingProviderCredit = providerCredits.get(event.provider_id) ?? {
        amountAtomic: 0n,
        eventCount: 0
      };
      existingProviderCredit.amountAtomic += providerCreditAtomic;
      existingProviderCredit.eventCount += 1;
      providerCredits.set(event.provider_id, existingProviderCredit);
    }

    if (totalBuyerDebitsAtomic === 0n) {
      return null;
    }

    const windowStartedAt = events[0].occurred_at;
    const windowEndedAt = events[events.length - 1].occurred_at;
    const batchId = buildBatchId();

    const batch = await tx.settlementBatch.create({
      data: {
        batch_id: batchId,
        status: "prepared",
        asset_identifier: sharedConfig.assetIdentifier,
        window_started_at: windowStartedAt,
        window_ended_at: windowEndedAt,
        total_buyer_debits_atomic: toDecimal(totalBuyerDebitsAtomic),
        total_provider_credits_atomic: toDecimal(totalProviderCreditsAtomic),
        platform_fee_atomic: toDecimal(platformFeeAtomic),
        line_count: buyerDebits.size + providerCredits.size + (platformFeeAtomic > 0n ? 1 : 0)
      }
    });

    const settlementLines: Prisma.SettlementLineCreateManyInput[] = [];

    for (const [buyerUserId, line] of buyerDebits.entries()) {
      settlementLines.push({
        batch_ref: batch.id,
        line_type: "buyer_debit",
        buyer_user_id: buyerUserId,
        provider_id: null,
        amount_atomic: toDecimal(line.amountAtomic),
        source_usage_event_count: line.eventCount
      });
    }

    for (const [providerId, line] of providerCredits.entries()) {
      settlementLines.push({
        batch_ref: batch.id,
        line_type: "provider_credit",
        buyer_user_id: null,
        provider_id: providerId,
        amount_atomic: toDecimal(line.amountAtomic),
        source_usage_event_count: line.eventCount
      });
    }

    if (platformFeeAtomic > 0n) {
      settlementLines.push({
        batch_ref: batch.id,
        line_type: "platform_fee",
        buyer_user_id: null,
        provider_id: null,
        amount_atomic: toDecimal(platformFeeAtomic),
        source_usage_event_count: events.length
      });
    }

    await tx.settlementLine.createMany({
      data: settlementLines
    });

    await tx.usageEvent.updateMany({
      where: {
        id: {
          in: events.map((event) => event.id)
        }
      },
      data: {
        settled_in_batch_id: batch.id
      }
    });

    logger.info("Prepared settlement batch", {
      batchId,
      eventCount: events.length,
      feeBps,
      totalBuyerDebitsAtomic: totalBuyerDebitsAtomic.toString(),
      totalProviderCreditsAtomic: totalProviderCreditsAtomic.toString(),
      platformFeeAtomic: platformFeeAtomic.toString()
    });

    return {
      id: batch.id,
      batchId,
      feeBps,
      eventCount: events.length,
      totalBuyerDebitsAtomic: totalBuyerDebitsAtomic.toString(),
      totalProviderCreditsAtomic: totalProviderCreditsAtomic.toString(),
      platformFeeAtomic: platformFeeAtomic.toString()
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable
  });
}

async function ensureProvidersRegisteredForBatch(input: {
  batchId: string;
  contractAddress: string;
  logger: Logger;
}) {
  const prisma = getPrismaClient();
  const secretKey = requireSettlementSecretKey();
  const session = await createSignerSession(secretKey);
  const providers = await prisma.provider.findMany({
    where: {
      settlementLines: {
        some: {
          batch_ref: input.batchId,
          line_type: "provider_credit"
        }
      }
    }
  });

  for (const provider of providers) {
    const hasProvider = await contractHasProvider({
      contractAddress: input.contractAddress,
      providerId: provider.id
    });

    if (!hasProvider) {
      const registerTxHash = await registerProviderOnChain(session, {
        contractAddress: input.contractAddress,
        providerId: provider.id,
        payoutWalletAddress: provider.payout_wallet_address
      });

      const observed = await waitForTransactionFinality({
        txHash: registerTxHash
      });

      if (!isSuccessfulStatus(observed.status)) {
        throw new Error(`Provider registration failed for ${provider.id}: ${observed.status}`);
      }

      input.logger.info("Registered provider on chain for settlement", {
        batchId: input.batchId,
        providerId: provider.id,
        txHash: registerTxHash
      });
      continue;
    }

    const payoutAddress = await getContractProviderPayoutAddress({
      contractAddress: input.contractAddress,
      providerId: provider.id
    });

    if (normalizeAddress(payoutAddress) === normalizeAddress(provider.payout_wallet_address)) {
      continue;
    }

    const updateTxHash = await updateProviderPayoutOnChain(session, {
      contractAddress: input.contractAddress,
      providerId: provider.id,
      payoutWalletAddress: provider.payout_wallet_address
    });

    const observed = await waitForTransactionFinality({
      txHash: updateTxHash
    });

    if (!isSuccessfulStatus(observed.status)) {
      throw new Error(`Provider payout update failed for ${provider.id}: ${observed.status}`);
    }

    input.logger.info("Updated provider payout on chain for settlement", {
      batchId: input.batchId,
      providerId: provider.id,
      txHash: updateTxHash
    });
  }
}

export async function submitPreparedSettlementBatch(logger: Logger) {
  const prisma = getPrismaClient();
  const { contractAddress } = requireSharedChainConfig();
  const batch = await prisma.settlementBatch.findFirst({
    where: {
      status: "prepared"
    },
    orderBy: {
      created_at: "asc"
    },
    include: {
      lines: {
        include: {
          buyer: {
            select: {
              wallet_address: true
            }
          },
          provider: {
            select: {
              payout_wallet_address: true
            }
          }
        }
      }
    }
  });

  if (!batch) {
    return null;
  }

  await ensureProvidersRegisteredForBatch({
    batchId: batch.id,
    contractAddress,
    logger
  });

  const buyerDebits: SettlementBuyerDebit[] = [];
  const providerCredits: SettlementProviderCredit[] = [];
  let feeAmountAtomic = "0";

  for (const line of batch.lines) {
    if (line.line_type === "buyer_debit") {
      const buyerWalletAddress = line.buyer?.wallet_address;
      if (!buyerWalletAddress) {
        throw new Error(`Settlement batch ${batch.batch_id} is missing a buyer wallet for line ${line.id}`);
      }

      buyerDebits.push({
        buyerWalletAddress,
        amountAtomic: line.amount_atomic.toString()
      });
      continue;
    }

    if (line.line_type === "provider_credit") {
      if (!line.provider_id) {
        throw new Error(`Settlement batch ${batch.batch_id} is missing a provider on line ${line.id}`);
      }

      providerCredits.push({
        providerId: line.provider_id,
        amountAtomic: line.amount_atomic.toString()
      });
      continue;
    }

    feeAmountAtomic = line.amount_atomic.toString();
  }

  const signerSession = await createSignerSession(requireSettlementSecretKey());
  const signerAddress = signerSession.account.address.toBech32();
  const txHash = await applySettlementBatchOnChain(signerSession, {
    contractAddress,
    batchId: batch.batch_id,
    buyerDebits,
    providerCredits,
    feeAmountAtomic
  });

  const submittedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.settlementBatch.update({
      where: {
        id: batch.id
      },
      data: {
        status: "submitted",
        tx_hash: txHash,
        submitted_at: submittedAt
      }
    });

    await tx.chainTransaction.upsert({
      where: {
        tx_hash: txHash
      },
      update: {
        tx_kind: "settlement",
        status: "submitted",
        wallet_address: signerAddress,
        related_batch_id: batch.id,
        amount_atomic: batch.total_buyer_debits_atomic,
        raw_response_json: Prisma.JsonNull
      },
      create: {
        tx_hash: txHash,
        tx_kind: "settlement",
        status: "submitted",
        wallet_address: signerAddress,
        related_batch_id: batch.id,
        amount_atomic: batch.total_buyer_debits_atomic
      }
    });
  });

  logger.info("Submitted settlement batch", {
    batchId: batch.batch_id,
    txHash,
    buyerDebitLineCount: buyerDebits.length,
    providerCreditLineCount: providerCredits.length,
    feeAmountAtomic
  });

  return {
    batchId: batch.batch_id,
    txHash
  };
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function markSubmittedBatchFailed(input: {
  txHash: string;
  batchId: string;
  observed: Awaited<ReturnType<typeof getTransactionStatus>>;
}) {
  const prisma = getPrismaClient();
  const failedAt = input.observed.timestamp ? new Date(input.observed.timestamp * 1000) : new Date();

  await prisma.$transaction(async (tx) => {
    await tx.chainTransaction.update({
      where: {
        tx_hash: input.txHash
      },
      data: {
        status: "failed",
        confirmed_at: failedAt,
        nonce: BigInt(input.observed.nonce),
        block_nonce: BigInt(input.observed.blockNonce),
        raw_response_json: toJsonValue(input.observed.raw)
      }
    });

    await tx.settlementBatch.update({
      where: {
        id: input.batchId
      },
      data: {
        status: "failed",
        failed_at: failedAt
      }
    });
  });
}

async function confirmSubmittedBatch(input: {
  txHash: string;
  batchId: string;
  batchPublicId: string;
  observed: Awaited<ReturnType<typeof getTransactionStatus>>;
}) {
  const prisma = getPrismaClient();
  const confirmedAt = input.observed.timestamp ? new Date(input.observed.timestamp * 1000) : new Date();
  const batch = await prisma.settlementBatch.findUnique({
    where: {
      id: input.batchId
    },
    include: {
      lines: true,
      usageEvents: {
        select: {
          id: true,
          provider_id: true,
          amount_atomic: true
        }
      }
    }
  });

  if (!batch) {
    throw new Error(`Settlement batch ${input.batchId} no longer exists`);
  }

  const buyerLines = batch.lines.filter((line) => line.line_type === "buyer_debit");
  const providerCreditLines = batch.lines.filter((line) => line.line_type === "provider_credit");
  const providerGrossById = new Map<string, bigint>();

  for (const event of batch.usageEvents) {
    const current = providerGrossById.get(event.provider_id) ?? 0n;
    providerGrossById.set(event.provider_id, current + decimalToBigInt(event.amount_atomic));
  }

  await prisma.$transaction(async (tx) => {
    await tx.chainTransaction.update({
      where: {
        tx_hash: input.txHash
      },
      data: {
        status: "confirmed",
        confirmed_at: confirmedAt,
        nonce: BigInt(input.observed.nonce),
        block_nonce: BigInt(input.observed.blockNonce),
        raw_response_json: toJsonValue(input.observed.raw)
      }
    });

    await tx.settlementBatch.update({
      where: {
        id: batch.id
      },
      data: {
        status: "confirmed",
        confirmed_at: confirmedAt
      }
    });

    for (const line of buyerLines) {
      if (!line.buyer_user_id) {
        continue;
      }

      await tx.$executeRaw(Prisma.sql`
        UPDATE buyer_balances
        SET
          onchain_confirmed_atomic = GREATEST(onchain_confirmed_atomic - ${line.amount_atomic}, 0),
          consumed_unsettled_atomic = GREATEST(consumed_unsettled_atomic - ${line.amount_atomic}, 0),
          updated_at = NOW()
        WHERE user_id = ${line.buyer_user_id}::uuid
      `);
    }

    for (const line of providerCreditLines) {
      if (!line.provider_id) {
        continue;
      }

      const grossAmountAtomic = providerGrossById.get(line.provider_id) ?? 0n;
      await tx.$executeRaw(Prisma.sql`
        UPDATE provider_balances
        SET
          unsettled_earned_atomic = GREATEST(unsettled_earned_atomic - ${toDecimal(grossAmountAtomic)}, 0),
          claimable_onchain_atomic = claimable_onchain_atomic + ${line.amount_atomic},
          updated_at = NOW()
        WHERE provider_id = ${line.provider_id}::uuid
      `);
    }

    await tx.usageReceipt.updateMany({
      where: {
        usage_event_id: {
          in: batch.usageEvents.map((event) => event.id)
        }
      },
      data: {
        chain_batch_id: input.batchPublicId
      }
    });
  });
}

export async function confirmSubmittedSettlementBatches(logger: Logger) {
  const prisma = getPrismaClient();
  const submittedTransactions = await prisma.chainTransaction.findMany({
    where: {
      tx_kind: "settlement",
      status: "submitted",
      related_batch_id: {
        not: null
      }
    },
    include: {
      relatedBatch: true
    },
    orderBy: {
      created_at: "asc"
    }
  });

  let confirmed = 0;
  let failed = 0;
  let pending = 0;

  for (const chainTransaction of submittedTransactions) {
    const observed = await getTransactionStatus(chainTransaction.tx_hash);

    if (isSuccessfulStatus(observed.status)) {
      await confirmSubmittedBatch({
        txHash: chainTransaction.tx_hash,
        batchId: chainTransaction.related_batch_id!,
        batchPublicId: chainTransaction.relatedBatch!.batch_id,
        observed
      });
      confirmed += 1;
      logger.info("Confirmed settlement batch", {
        batchId: chainTransaction.relatedBatch!.batch_id,
        txHash: chainTransaction.tx_hash
      });
      continue;
    }

    if (isFailureStatus(observed.status)) {
      await markSubmittedBatchFailed({
        txHash: chainTransaction.tx_hash,
        batchId: chainTransaction.related_batch_id!,
        observed
      });
      failed += 1;
      logger.warn("Settlement batch failed on chain", {
        batchId: chainTransaction.relatedBatch!.batch_id,
        txHash: chainTransaction.tx_hash,
        status: observed.status
      });
      continue;
    }

    pending += 1;
  }

  return {
    confirmed,
    failed,
    pending
  };
}

export async function runSettlementCycle(logger: Logger) {
  const confirmationResult = await confirmSubmittedSettlementBatches(logger);
  const existingPreparedSubmission = await submitPreparedSettlementBatch(logger);
  const createdBatch = existingPreparedSubmission ? null : await createSettlementBatch(logger);
  const createdBatchSubmission = existingPreparedSubmission || !createdBatch
    ? null
    : await submitPreparedSettlementBatch(logger);

  return {
    confirmationResult,
    submittedBatch: existingPreparedSubmission ?? createdBatchSubmission,
    createdBatch
  };
}
