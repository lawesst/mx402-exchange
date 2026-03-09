import { Prisma, getPrismaClient } from "@mx402/db";
import { loadSharedRuntimeConfig } from "@mx402/config";
import { atomicToString, computeSpendableAtomic } from "@mx402/domain";

export async function ensureBuyerBalance(userId: string) {
  const prisma = getPrismaClient();
  const runtimeConfig = loadSharedRuntimeConfig();

  return prisma.buyerBalance.upsert({
    where: {
      user_id: userId
    },
    update: {
      asset_identifier: runtimeConfig.assetIdentifier
    },
    create: {
      user_id: userId,
      asset_identifier: runtimeConfig.assetIdentifier
    }
  });
}

export function serializeBuyerBalance(balance: {
  asset_identifier: string;
  onchain_confirmed_atomic: Prisma.Decimal;
  reserved_atomic: Prisma.Decimal;
  consumed_unsettled_atomic: Prisma.Decimal;
}) {
  return {
    assetIdentifier: balance.asset_identifier,
    onchainConfirmedAtomic: atomicToString(balance.onchain_confirmed_atomic),
    reservedAtomic: atomicToString(balance.reserved_atomic),
    consumedUnsettledAtomic: atomicToString(balance.consumed_unsettled_atomic),
    spendableAtomic: computeSpendableAtomic({
      onchainConfirmedAtomic: balance.onchain_confirmed_atomic,
      reservedAtomic: balance.reserved_atomic,
      consumedUnsettledAtomic: balance.consumed_unsettled_atomic
    })
  };
}
