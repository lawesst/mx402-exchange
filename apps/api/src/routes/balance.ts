import type { FastifyInstance } from "fastify";

import { getPrismaClient } from "@mx402/db";
import { loadSharedRuntimeConfig, requireEnv } from "@mx402/config";
import { prepareDepositSchema, trackDepositSchema } from "@mx402/domain";
import { prepareDepositCall, prepareWithdrawCall } from "@mx402/multiversx";

import { requireSession } from "../auth.js";
import { ensureBuyerBalance, serializeBuyerBalance } from "../balance.js";
import { trackDepositTransaction } from "../deposits.js";

export async function registerBalanceRoutes(app: FastifyInstance) {
  app.get("/v1/balance", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const balance = await ensureBuyerBalance(auth.userId);
    return reply.code(200).send(serializeBuyerBalance(balance));
  });

  app.post("/v1/balance/deposit/prepare", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const { amountAtomic } = prepareDepositSchema.parse(request.body);
    const config = loadSharedRuntimeConfig();
    const balance = await ensureBuyerBalance(auth.userId);

    return reply.code(200).send({
      ...prepareDepositCall({
        contractAddress: requireEnv("MX402_LEDGER_CONTRACT"),
        chainId: config.chainId,
        tokenIdentifier: config.assetIdentifier,
        amountAtomic
      }),
      balance: serializeBuyerBalance(balance)
    });
  });

  app.post("/v1/balance/deposits/track", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const { txHash, amountAtomic } = trackDepositSchema.parse(request.body);
    const tracked = await trackDepositTransaction({
      txHash,
      walletAddress: auth.walletAddress,
      userId: auth.userId,
      amountAtomic
    });

    return reply.code(202).send({
      txHash: tracked.tx_hash,
      status: tracked.status,
      txKind: tracked.tx_kind
    });
  });

  app.post("/v1/balance/withdraw/prepare", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const { amountAtomic } = prepareDepositSchema.parse(request.body);
    const config = loadSharedRuntimeConfig();
    const balance = await ensureBuyerBalance(auth.userId);
    const serializedBalance = serializeBuyerBalance(balance);

    if (BigInt(serializedBalance.spendableAtomic) < BigInt(amountAtomic)) {
      return reply.code(402).send({
        error: {
          code: "INSUFFICIENT_BALANCE",
          message: "Insufficient spendable balance for this withdrawal",
          requiredAtomic: amountAtomic,
          availableAtomic: serializedBalance.spendableAtomic,
          assetIdentifier: config.assetIdentifier
        }
      });
    }

    return reply.code(200).send({
      ...prepareWithdrawCall({
        contractAddress: requireEnv("MX402_LEDGER_CONTRACT"),
        chainId: config.chainId,
        amountAtomic
      }),
      balance: serializedBalance
    });
  });

  app.get("/v1/chain-transactions", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const prisma = getPrismaClient();
    const transactions = await prisma.chainTransaction.findMany({
      where: {
        related_user_id: auth.userId
      },
      orderBy: {
        created_at: "desc"
      },
      take: 50
    });

    return reply.code(200).send({
      data: transactions.map((transaction) => ({
        txHash: transaction.tx_hash,
        txKind: transaction.tx_kind,
        status: transaction.status,
        walletAddress: transaction.wallet_address,
        amountAtomic: transaction.amount_atomic?.toString() ?? null,
        confirmedAt: transaction.confirmed_at?.toISOString() ?? null,
        createdAt: transaction.created_at.toISOString(),
        updatedAt: transaction.updated_at.toISOString()
      }))
    });
  });
}
