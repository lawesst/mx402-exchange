import { Prisma, getPrismaClient } from "@mx402/db";

export async function trackDepositTransaction(input: {
  txHash: string;
  walletAddress: string;
  userId: string;
  amountAtomic?: string;
}) {
  const prisma = getPrismaClient();

  return prisma.chainTransaction.upsert({
    where: {
      tx_hash: input.txHash
    },
    update: {
      tx_kind: "deposit",
      status: "submitted",
      wallet_address: input.walletAddress,
      related_user_id: input.userId,
      amount_atomic: input.amountAtomic ? new Prisma.Decimal(input.amountAtomic) : undefined,
      raw_response_json: Prisma.JsonNull
    },
    create: {
      tx_hash: input.txHash,
      tx_kind: "deposit",
      status: "submitted",
      wallet_address: input.walletAddress,
      related_user_id: input.userId,
      amount_atomic: input.amountAtomic ? new Prisma.Decimal(input.amountAtomic) : undefined
    }
  });
}

export async function trackProviderClaimTransaction(input: {
  txHash: string;
  walletAddress: string;
  providerId: string;
  amountAtomic: string;
}) {
  const prisma = getPrismaClient();

  return prisma.chainTransaction.upsert({
    where: {
      tx_hash: input.txHash
    },
    update: {
      tx_kind: "provider_claim",
      status: "submitted",
      wallet_address: input.walletAddress,
      related_provider_id: input.providerId,
      amount_atomic: new Prisma.Decimal(input.amountAtomic),
      raw_response_json: Prisma.JsonNull
    },
    create: {
      tx_hash: input.txHash,
      tx_kind: "provider_claim",
      status: "submitted",
      wallet_address: input.walletAddress,
      related_provider_id: input.providerId,
      amount_atomic: new Prisma.Decimal(input.amountAtomic)
    }
  });
}
