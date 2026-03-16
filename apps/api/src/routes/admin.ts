import type { FastifyInstance } from "fastify";

import { Prisma, getPrismaClient } from "@mx402/db";
import { adminNotesSchema } from "@mx402/domain";
import { createLogger } from "@mx402/observability";

import { requireAdminSession } from "../auth.js";
import { confirmSubmittedSettlementBatches } from "../../../worker/src/settlements.js";

const settlementRefreshLogger = createLogger("admin-settlement-refresh");

async function appendAuditLog(input: {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId?: string;
  payload?: Record<string, unknown>;
}) {
  const prisma = getPrismaClient();
  await prisma.adminAuditLog.create({
    data: {
      actor_user_id: input.actorUserId,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId,
      payload_json: (input.payload ?? {}) as Prisma.InputJsonValue
    }
  });
}

export async function registerAdminRoutes(app: FastifyInstance) {
  app.get("/v1/admin/providers", async (request, reply) => {
    const auth = await requireAdminSession(request, reply);
    if (!auth) {
      return reply;
    }

    const prisma = getPrismaClient();
    const providers = await prisma.provider.findMany({
      include: {
        user: true,
        products: {
          orderBy: {
            created_at: "desc"
          }
        }
      },
      orderBy: {
        created_at: "desc"
      }
    });

    return reply.code(200).send({
      data: providers.map((provider) => ({
        id: provider.id,
        slug: provider.slug,
        status: provider.status,
        displayName: provider.display_name,
        payoutWalletAddress: provider.payout_wallet_address,
        walletAddress: provider.user.wallet_address,
        approvalNotes: provider.approval_notes,
        approvedAt: provider.approved_at?.toISOString() ?? null,
        products: provider.products.map((product) => ({
          id: product.id,
          slug: product.slug,
          name: product.name,
          status: product.status
        })),
        createdAt: provider.created_at.toISOString()
      }))
    });
  });

  app.post("/v1/admin/providers/:providerId/approve", async (request, reply) => {
    const auth = await requireAdminSession(request, reply);
    if (!auth) {
      return reply;
    }

    const { providerId } = request.params as { providerId: string };
    const input = adminNotesSchema.parse(request.body ?? {});
    const prisma = getPrismaClient();
    const provider = await prisma.provider.update({
      where: {
        id: providerId
      },
      data: {
        status: "approved",
        approval_notes: input.notes ?? null,
        approved_at: new Date()
      }
    });

    await prisma.providerBalance.upsert({
      where: {
        provider_id: provider.id
      },
      update: {},
      create: {
        provider_id: provider.id
      }
    });

    await appendAuditLog({
      actorUserId: auth.userId,
      action: "approve_provider",
      entityType: "provider",
      entityId: provider.id,
      payload: {
        notes: input.notes ?? null
      }
    });

    return reply.code(200).send({
      id: provider.id,
      status: provider.status,
      approvedAt: provider.approved_at?.toISOString() ?? null
    });
  });

  app.post("/v1/admin/providers/:providerId/reject", async (request, reply) => {
    const auth = await requireAdminSession(request, reply);
    if (!auth) {
      return reply;
    }

    const { providerId } = request.params as { providerId: string };
    const input = adminNotesSchema.parse(request.body ?? {});
    const prisma = getPrismaClient();
    const provider = await prisma.provider.update({
      where: {
        id: providerId
      },
      data: {
        status: "rejected",
        approval_notes: input.notes ?? null,
        approved_at: null
      }
    });

    await appendAuditLog({
      actorUserId: auth.userId,
      action: "reject_provider",
      entityType: "provider",
      entityId: provider.id,
      payload: {
        notes: input.notes ?? null
      }
    });

    return reply.code(200).send({
      id: provider.id,
      status: provider.status
    });
  });

  app.post("/v1/admin/products/:productId/activate", async (request, reply) => {
    const auth = await requireAdminSession(request, reply);
    if (!auth) {
      return reply;
    }

    const { productId } = request.params as { productId: string };
    const input = adminNotesSchema.parse(request.body ?? {});
    const prisma = getPrismaClient();
    const product = await prisma.providerProduct.findUnique({
      where: {
        id: productId
      },
      include: {
        provider: true
      }
    });

    if (!product) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Product not found"
        }
      });
    }

    if (product.provider.status !== "approved") {
      return reply.code(409).send({
        error: {
          code: "INVALID_PROVIDER_STATE",
          message: "Provider must be approved before a product can be activated"
        }
      });
    }

    const updated = await prisma.providerProduct.update({
      where: {
        id: product.id
      },
      data: {
        status: "active"
      }
    });

    await appendAuditLog({
      actorUserId: auth.userId,
      action: "activate_product",
      entityType: "product",
      entityId: updated.id,
      payload: {
        notes: input.notes ?? null
      }
    });

    return reply.code(200).send({
      id: updated.id,
      status: updated.status
    });
  });

  app.post("/v1/admin/products/:productId/pause", async (request, reply) => {
    const auth = await requireAdminSession(request, reply);
    if (!auth) {
      return reply;
    }

    const { productId } = request.params as { productId: string };
    const input = adminNotesSchema.parse(request.body ?? {});
    const prisma = getPrismaClient();
    const updated = await prisma.providerProduct.update({
      where: {
        id: productId
      },
      data: {
        status: "paused"
      }
    });

    await appendAuditLog({
      actorUserId: auth.userId,
      action: "pause_product",
      entityType: "product",
      entityId: updated.id,
      payload: {
        notes: input.notes ?? null
      }
    });

    return reply.code(200).send({
      id: updated.id,
      status: updated.status
    });
  });

  app.get("/v1/admin/settlement-batches", async (request, reply) => {
    const auth = await requireAdminSession(request, reply);
    if (!auth) {
      return reply;
    }

    const prisma = getPrismaClient();
    const batches = await prisma.settlementBatch.findMany({
      include: {
        lines: {
          include: {
            buyer: true,
            provider: true
          },
          orderBy: [
            {
              line_type: "asc"
            },
            {
              amount_atomic: "desc"
            }
          ]
        }
      },
      orderBy: {
        created_at: "desc"
      },
      take: 100
    });

    return reply.code(200).send({
      data: batches.map((batch) => ({
        id: batch.id,
        batchId: batch.batch_id,
        status: batch.status,
        assetIdentifier: batch.asset_identifier,
        totalBuyerDebitsAtomic: batch.total_buyer_debits_atomic.toString(),
        totalProviderCreditsAtomic: batch.total_provider_credits_atomic.toString(),
        platformFeeAtomic: batch.platform_fee_atomic.toString(),
        lineCount: batch.line_count,
        txHash: batch.tx_hash,
        windowStartedAt: batch.window_started_at.toISOString(),
        windowEndedAt: batch.window_ended_at.toISOString(),
        submittedAt: batch.submitted_at?.toISOString() ?? null,
        confirmedAt: batch.confirmed_at?.toISOString() ?? null,
        failedAt: batch.failed_at?.toISOString() ?? null,
        createdAt: batch.created_at.toISOString(),
        lines: batch.lines.map((line) => ({
          id: line.id,
          lineType: line.line_type,
          amountAtomic: line.amount_atomic.toString(),
          sourceUsageEventCount: line.source_usage_event_count,
          buyerWalletAddress: line.buyer?.wallet_address ?? null,
          providerId: line.provider_id,
          providerSlug: line.provider?.slug ?? null,
          providerDisplayName: line.provider?.display_name ?? null,
          createdAt: line.created_at.toISOString()
        }))
      }))
    });
  });

  app.post("/v1/admin/settlement-batches/refresh", async (request, reply) => {
    const auth = await requireAdminSession(request, reply);
    if (!auth) {
      return reply;
    }

    const confirmation = await confirmSubmittedSettlementBatches(settlementRefreshLogger);

    await appendAuditLog({
      actorUserId: auth.userId,
      action: "refresh_settlement_batches",
      entityType: "settlement_batch"
    });

    return reply.code(200).send(confirmation);
  });

  app.post("/v1/admin/settlement-batches/:batchId/retry", async (request, reply) => {
    const auth = await requireAdminSession(request, reply);
    if (!auth) {
      return reply;
    }

    const { batchId } = request.params as { batchId: string };
    const prisma = getPrismaClient();
    const batch = await prisma.settlementBatch.update({
      where: {
        id: batchId
      },
      data: {
        status: "prepared",
        failed_at: null
      }
    });

    await appendAuditLog({
      actorUserId: auth.userId,
      action: "retry_settlement_batch",
      entityType: "settlement_batch",
      entityId: batch.id
    });

    return reply.code(200).send({
      id: batch.id,
      status: batch.status
    });
  });
}
