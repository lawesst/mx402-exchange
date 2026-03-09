import type { FastifyInstance } from "fastify";

import { getPrismaClient } from "@mx402/db";

import { requireSession } from "../auth.js";

export async function registerUsageRoutes(app: FastifyInstance) {
  app.get("/v1/usage/events", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const prisma = getPrismaClient();
    const events = await prisma.usageEvent.findMany({
      where: {
        buyer_user_id: auth.userId
      },
      include: {
        product: {
          include: {
            provider: true
          }
        },
        usageReceipt: true
      },
      orderBy: {
        occurred_at: "desc"
      },
      take: 100
    });

    return reply.code(200).send({
      data: events.map((event) => ({
        id: event.id,
        requestStatus: event.request_status,
        charged: event.charged,
        amountAtomic: event.amount_atomic.toString(),
        providerStatusCode: event.upstream_status_code,
        latencyMs: event.upstream_latency_ms,
        product: {
          id: event.product.id,
          slug: event.product.slug,
          name: event.product.name,
          providerName: event.product.provider.display_name
        },
        receiptId: event.usageReceipt?.public_receipt_id ?? null,
        occurredAt: event.occurred_at.toISOString()
      }))
    });
  });

  app.get("/v1/usage/receipts/:receiptId", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const { receiptId } = request.params as { receiptId: string };
    const prisma = getPrismaClient();
    const receipt = await prisma.usageReceipt.findFirst({
      where: {
        public_receipt_id: receiptId,
        usageEvent: {
          buyer_user_id: auth.userId
        }
      },
      include: {
        usageEvent: {
          include: {
            product: {
              include: {
                provider: true
              }
            }
          }
        }
      }
    });

    if (!receipt) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Usage receipt not found"
        }
      });
    }

    return reply.code(200).send({
      id: receipt.public_receipt_id,
      amountAtomic: receipt.amount_atomic.toString(),
      assetIdentifier: receipt.asset_identifier,
      buyerWalletAddress: receipt.buyer_wallet_address,
      providerWalletAddress: receipt.provider_wallet_address,
      chainBatchId: receipt.chain_batch_id,
      productSnapshot: receipt.product_snapshot,
      usageEvent: {
        id: receipt.usageEvent.id,
        requestStatus: receipt.usageEvent.request_status,
        providerStatusCode: receipt.usageEvent.upstream_status_code,
        latencyMs: receipt.usageEvent.upstream_latency_ms,
        product: {
          id: receipt.usageEvent.product.id,
          slug: receipt.usageEvent.product.slug,
          name: receipt.usageEvent.product.name,
          providerName: receipt.usageEvent.product.provider.display_name
        }
      },
      createdAt: receipt.created_at.toISOString()
    });
  });
}
