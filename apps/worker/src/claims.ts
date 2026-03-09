import { Prisma, getPrismaClient } from "@mx402/db";
import type { Logger } from "@mx402/observability";

import { getTransactionStatus, isFailureStatus, isSuccessfulStatus } from "./chain.js";

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function confirmSubmittedProviderClaims(logger: Logger) {
  const prisma = getPrismaClient();
  const submittedClaims = await prisma.chainTransaction.findMany({
    where: {
      tx_kind: "provider_claim",
      status: "submitted",
      related_provider_id: {
        not: null
      }
    },
    orderBy: {
      created_at: "asc"
    }
  });

  let confirmed = 0;
  let failed = 0;
  let pending = 0;

  for (const claim of submittedClaims) {
    const observed = await getTransactionStatus(claim.tx_hash);

    if (isSuccessfulStatus(observed.status)) {
      const confirmedAt = observed.timestamp ? new Date(observed.timestamp * 1000) : new Date();

      await prisma.$transaction(async (tx) => {
        await tx.chainTransaction.update({
          where: {
            tx_hash: claim.tx_hash
          },
          data: {
            status: "confirmed",
            confirmed_at: confirmedAt,
            nonce: BigInt(observed.nonce),
            block_nonce: BigInt(observed.blockNonce),
            raw_response_json: toJsonValue(observed.raw)
          }
        });

        if (claim.related_provider_id && claim.amount_atomic) {
          await tx.$executeRaw(Prisma.sql`
            UPDATE provider_balances
            SET
              claimable_onchain_atomic = GREATEST(claimable_onchain_atomic - ${claim.amount_atomic}, 0),
              claimed_total_atomic = claimed_total_atomic + ${claim.amount_atomic},
              updated_at = NOW()
            WHERE provider_id = ${claim.related_provider_id}::uuid
          `);
        }
      });

      confirmed += 1;
      logger.info("Confirmed provider claim transaction", {
        txHash: claim.tx_hash,
        providerId: claim.related_provider_id
      });
      continue;
    }

    if (isFailureStatus(observed.status)) {
      const failedAt = observed.timestamp ? new Date(observed.timestamp * 1000) : new Date();

      await prisma.chainTransaction.update({
        where: {
          tx_hash: claim.tx_hash
        },
        data: {
          status: "failed",
          confirmed_at: failedAt,
          nonce: BigInt(observed.nonce),
          block_nonce: BigInt(observed.blockNonce),
          raw_response_json: toJsonValue(observed.raw)
        }
      });

      failed += 1;
      logger.warn("Provider claim transaction failed on chain", {
        txHash: claim.tx_hash,
        providerId: claim.related_provider_id,
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
