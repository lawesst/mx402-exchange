import type { FastifyInstance } from "fastify";

import { Prisma, getPrismaClient } from "@mx402/db";
import { encryptProviderSecret, loadSharedRuntimeConfig, requireEnv } from "@mx402/config";
import { createLogger } from "@mx402/observability";
import {
  createProductSchema,
  createProviderSchema,
  prepareProviderClaimSchema,
  trackProviderClaimSchema,
  updateProductSchema,
  updateProviderSchema
} from "@mx402/domain";
import { prepareClaimProviderEarningsCall } from "@mx402/multiversx";

import { requireSession } from "../auth.js";
import { trackProviderClaimTransaction } from "../deposits.js";
import { confirmSubmittedProviderClaims } from "../../../worker/src/claims.js";

const claimRefreshLogger = createLogger("provider-claim-refresh");

function isUniqueConstraintError(error: unknown, fieldName: string) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    Array.isArray(error.meta?.target) &&
    error.meta.target.includes(fieldName)
  );
}

function serializeProvider(provider: {
  id: string;
  user_id: string;
  status: string;
  slug: string;
  display_name: string;
  description: string | null;
  website_url: string | null;
  payout_wallet_address: string;
  approval_notes: string | null;
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: provider.id,
    userId: provider.user_id,
    status: provider.status,
    slug: provider.slug,
    displayName: provider.display_name,
    description: provider.description,
    websiteUrl: provider.website_url,
    payoutWalletAddress: provider.payout_wallet_address,
    approvalNotes: provider.approval_notes,
    approvedAt: provider.approved_at?.toISOString() ?? null,
    createdAt: provider.created_at.toISOString(),
    updatedAt: provider.updated_at.toISOString()
  };
}

function serializeProduct(product: {
  id: string;
  provider_id: string;
  status: string;
  slug: string;
  name: string;
  short_description: string;
  description: string | null;
  base_url: string;
  upstream_path_template: string;
  upstream_method: "GET" | "POST";
  price_atomic: { toString(): string };
  timeout_ms: number;
  rate_limit_per_minute: number;
  charge_policy: string;
  origin_auth_mode: string;
  origin_auth_header_name: string | null;
  origin_auth_secret_ciphertext?: string | null;
  path_params_schema_json: unknown;
  input_schema_json: unknown;
  query_schema_json: unknown;
  output_schema_json: unknown;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    id: product.id,
    providerId: product.provider_id,
    status: product.status,
    slug: product.slug,
    name: product.name,
    shortDescription: product.short_description,
    description: product.description,
    baseUrl: product.base_url,
    upstreamPathTemplate: product.upstream_path_template,
    upstreamMethod: product.upstream_method,
    priceAtomic: product.price_atomic.toString(),
    timeoutMs: product.timeout_ms,
    rateLimitPerMinute: product.rate_limit_per_minute,
    chargePolicy: product.charge_policy,
    originAuthMode: product.origin_auth_mode,
    originAuthHeaderName: product.origin_auth_header_name,
    originAuthSecretConfigured: Boolean(product.origin_auth_secret_ciphertext),
    pathParamsSchemaJson: product.path_params_schema_json,
    inputSchemaJson: product.input_schema_json,
    querySchemaJson: product.query_schema_json,
    outputSchemaJson: product.output_schema_json,
    createdAt: product.created_at.toISOString(),
    updatedAt: product.updated_at.toISOString()
  };
}

export async function registerProviderRoutes(app: FastifyInstance) {
  app.post("/v1/providers", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const input = createProviderSchema.parse(request.body);
    const prisma = getPrismaClient();
    const existingProvider = await prisma.provider.findUnique({
      where: {
        user_id: auth.userId
      }
    });

    if (existingProvider) {
      return reply.code(409).send({
        error: {
          code: "PROVIDER_EXISTS",
          message: "This user already has a provider profile"
        }
      });
    }

    let provider;
    try {
      provider = await prisma.provider.create({
        data: {
          user_id: auth.userId,
          slug: input.slug,
          display_name: input.displayName,
          description: input.description ?? null,
          website_url: input.websiteUrl ?? null,
          payout_wallet_address: input.payoutWalletAddress,
          status: "pending"
        }
      });
    } catch (error) {
      if (isUniqueConstraintError(error, "slug")) {
        return reply.code(409).send({
          error: {
            code: "SLUG_CONFLICT",
            message: "Provider slug is already in use. Choose a different slug."
          }
        });
      }

      throw error;
    }

    return reply.code(201).send(serializeProvider(provider));
  });

  app.get("/v1/providers/me", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const prisma = getPrismaClient();
    const provider = await prisma.provider.findUnique({
      where: {
        user_id: auth.userId
      }
    });

    if (!provider) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Provider profile not found"
        }
      });
    }

    return reply.code(200).send(serializeProvider(provider));
  });

  app.patch("/v1/providers/me", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const input = updateProviderSchema.parse(request.body);
    const prisma = getPrismaClient();
    const existingProvider = await prisma.provider.findUnique({
      where: {
        user_id: auth.userId
      }
    });

    if (!existingProvider) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Provider profile not found"
        }
      });
    }

    const payoutChanged =
      input.payoutWalletAddress !== undefined && input.payoutWalletAddress !== existingProvider.payout_wallet_address;

    let provider;
    try {
      provider = await prisma.provider.update({
        where: {
          id: existingProvider.id
        },
        data: {
          slug: input.slug ?? undefined,
          display_name: input.displayName ?? undefined,
          description: input.description ?? undefined,
          website_url: input.websiteUrl ?? undefined,
          payout_wallet_address: input.payoutWalletAddress ?? undefined,
          status: payoutChanged && existingProvider.status === "approved" ? "pending" : undefined,
          approved_at: payoutChanged && existingProvider.status === "approved" ? null : undefined
        }
      });
    } catch (error) {
      if (isUniqueConstraintError(error, "slug")) {
        return reply.code(409).send({
          error: {
            code: "SLUG_CONFLICT",
            message: "Provider slug is already in use. Choose a different slug."
          }
        });
      }

      throw error;
    }

    return reply.code(200).send(serializeProvider(provider));
  });

  app.post("/v1/providers/me/products", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const input = createProductSchema.parse(request.body);
    const prisma = getPrismaClient();
    const provider = await prisma.provider.findUnique({
      where: {
        user_id: auth.userId
      }
    });

    if (!provider) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Provider profile not found"
        }
      });
    }

    let product;
    try {
      product = await prisma.providerProduct.create({
        data: {
          provider_id: provider.id,
          status: "draft",
          slug: input.slug,
          name: input.name,
          short_description: input.shortDescription,
          description: input.description ?? null,
          base_url: input.baseUrl,
          upstream_path_template: input.upstreamPathTemplate,
          upstream_method: input.upstreamMethod,
          price_atomic: input.priceAtomic,
          timeout_ms: input.timeoutMs,
          rate_limit_per_minute: input.rateLimitPerMinute,
          origin_auth_mode: input.originAuthMode,
          origin_auth_header_name: input.originAuthMode === "static_header" ? input.originAuthHeaderName ?? null : null,
          origin_auth_secret_ciphertext:
            input.originAuthMode === "static_header" && input.originAuthSecret
              ? encryptProviderSecret(input.originAuthSecret)
              : null,
          path_params_schema_json: input.pathParamsSchemaJson as Prisma.InputJsonValue,
          input_schema_json: input.inputSchemaJson as Prisma.InputJsonValue,
          query_schema_json: input.querySchemaJson as Prisma.InputJsonValue,
          output_schema_json: input.outputSchemaJson as Prisma.InputJsonValue
        }
      });
    } catch (error) {
      if (isUniqueConstraintError(error, "slug")) {
        return reply.code(409).send({
          error: {
            code: "SLUG_CONFLICT",
            message: "Product slug is already in use. Choose a different slug."
          }
        });
      }

      throw error;
    }

    return reply.code(201).send(serializeProduct(product));
  });

  app.get("/v1/providers/me/products", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const prisma = getPrismaClient();
    const provider = await prisma.provider.findUnique({
      where: {
        user_id: auth.userId
      }
    });

    if (!provider) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Provider profile not found"
        }
      });
    }

    const products = await prisma.providerProduct.findMany({
      where: {
        provider_id: provider.id
      },
      orderBy: {
        created_at: "desc"
      }
    });

    return reply.code(200).send({
      data: products.map((product) => serializeProduct(product))
    });
  });

  app.get("/v1/providers/me/products/:productId", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const { productId } = request.params as { productId: string };
    const prisma = getPrismaClient();
    const product = await prisma.providerProduct.findFirst({
      where: {
        id: productId,
        provider: {
          user_id: auth.userId
        }
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

    return reply.code(200).send(serializeProduct(product));
  });

  app.patch("/v1/providers/me/products/:productId", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const { productId } = request.params as { productId: string };
    const input = updateProductSchema.parse(request.body);
    const prisma = getPrismaClient();
    const existingProduct = await prisma.providerProduct.findFirst({
      where: {
        id: productId,
        provider: {
          user_id: auth.userId
        }
      }
    });

    if (!existingProduct) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Product not found"
        }
      });
    }

    if (!["draft", "paused"].includes(existingProduct.status)) {
      return reply.code(409).send({
        error: {
          code: "INVALID_PRODUCT_STATE",
          message: "Only draft or paused products can be updated"
        }
      });
    }

    const nextOriginAuthMode = input.originAuthMode ?? existingProduct.origin_auth_mode;
    const nextOriginAuthHeaderName =
      nextOriginAuthMode === "static_header"
        ? input.originAuthHeaderName ?? existingProduct.origin_auth_header_name
        : null;

    if (nextOriginAuthMode === "static_header" && !nextOriginAuthHeaderName) {
      return reply.code(422).send({
        error: {
          code: "INVALID_PRODUCT_INPUT",
          message: "Static header auth requires a header name"
        }
      });
    }

    if (
      nextOriginAuthMode === "static_header" &&
      input.originAuthSecret === undefined &&
      !existingProduct.origin_auth_secret_ciphertext
    ) {
      return reply.code(422).send({
        error: {
          code: "INVALID_PRODUCT_INPUT",
          message: "Static header auth requires a secret"
        }
      });
    }

    const nextOriginAuthSecretCiphertext =
      nextOriginAuthMode === "static_header"
        ? input.originAuthSecret !== undefined
          ? encryptProviderSecret(input.originAuthSecret)
          : existingProduct.origin_auth_secret_ciphertext
        : null;

    let product;
    try {
      product = await prisma.providerProduct.update({
        where: {
          id: existingProduct.id
        },
        data: {
          slug: input.slug ?? undefined,
          name: input.name ?? undefined,
          short_description: input.shortDescription ?? undefined,
          description: input.description ?? undefined,
          base_url: input.baseUrl ?? undefined,
          upstream_path_template: input.upstreamPathTemplate ?? undefined,
          upstream_method: input.upstreamMethod ?? undefined,
          price_atomic: input.priceAtomic ?? undefined,
          timeout_ms: input.timeoutMs ?? undefined,
          rate_limit_per_minute: input.rateLimitPerMinute ?? undefined,
          origin_auth_mode: input.originAuthMode ?? undefined,
          origin_auth_header_name:
            input.originAuthMode !== undefined || input.originAuthHeaderName !== undefined
              ? nextOriginAuthHeaderName
              : undefined,
          origin_auth_secret_ciphertext:
            input.originAuthMode !== undefined || input.originAuthSecret !== undefined
              ? nextOriginAuthSecretCiphertext
              : undefined,
          path_params_schema_json: (input.pathParamsSchemaJson as Prisma.InputJsonValue | undefined) ?? undefined,
          input_schema_json: (input.inputSchemaJson as Prisma.InputJsonValue | undefined) ?? undefined,
          query_schema_json: (input.querySchemaJson as Prisma.InputJsonValue | undefined) ?? undefined,
          output_schema_json: (input.outputSchemaJson as Prisma.InputJsonValue | undefined) ?? undefined
        }
      });
    } catch (error) {
      if (isUniqueConstraintError(error, "slug")) {
        return reply.code(409).send({
          error: {
            code: "SLUG_CONFLICT",
            message: "Product slug is already in use. Choose a different slug."
          }
        });
      }

      throw error;
    }

    return reply.code(200).send(serializeProduct(product));
  });

  app.post("/v1/providers/me/products/:productId/submit", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const { productId } = request.params as { productId: string };
    const prisma = getPrismaClient();
    const existingProduct = await prisma.providerProduct.findFirst({
      where: {
        id: productId,
        provider: {
          user_id: auth.userId
        }
      }
    });

    if (!existingProduct) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Product not found"
        }
      });
    }

    if (!["draft", "paused"].includes(existingProduct.status)) {
      return reply.code(409).send({
        error: {
          code: "INVALID_PRODUCT_STATE",
          message: "Only draft or paused products can be submitted"
        }
      });
    }

    const product = await prisma.providerProduct.update({
      where: {
        id: existingProduct.id
      },
      data: {
        status: "pending_review"
      }
    });

    return reply.code(200).send(serializeProduct(product));
  });

  app.get("/v1/providers/me/earnings", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const prisma = getPrismaClient();
    const provider = await prisma.provider.findUnique({
      where: {
        user_id: auth.userId
      },
      include: {
        balance: true
      }
    });

    if (!provider) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Provider profile not found"
        }
      });
    }

    const recentUsage = await prisma.usageEvent.findMany({
      where: {
        provider_id: provider.id
      },
      orderBy: {
        occurred_at: "desc"
      },
      take: 20
    });

    return reply.code(200).send({
      providerId: provider.id,
      status: provider.status,
      balances: {
        unsettledEarnedAtomic: provider.balance?.unsettled_earned_atomic.toString() ?? "0",
        claimableOnchainAtomic: provider.balance?.claimable_onchain_atomic.toString() ?? "0",
        claimedTotalAtomic: provider.balance?.claimed_total_atomic.toString() ?? "0"
      },
      recentUsage: recentUsage.map((event) => ({
        id: event.id,
        productId: event.product_id,
        requestStatus: event.request_status,
        charged: event.charged,
        amountAtomic: event.amount_atomic.toString(),
        occurredAt: event.occurred_at.toISOString()
      }))
    });
  });

  app.post("/v1/providers/me/claim/prepare", async (_request, reply) => {
    const auth = await requireSession(_request, reply);
    if (!auth) {
      return reply;
    }

    const input = prepareProviderClaimSchema.parse(_request.body ?? {});
    const prisma = getPrismaClient();
    const provider = await prisma.provider.findUnique({
      where: {
        user_id: auth.userId
      },
      include: {
        balance: true
      }
    });

    if (!provider) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Provider profile not found"
        }
      });
    }

    if (provider.payout_wallet_address !== auth.walletAddress) {
      return reply.code(409).send({
        error: {
          code: "PAYOUT_WALLET_MISMATCH",
          message: "Connect the configured payout wallet to claim provider earnings"
        }
      });
    }

    const claimableAtomic = BigInt(provider.balance?.claimable_onchain_atomic.toString() ?? "0");
    if (claimableAtomic <= 0n) {
      return reply.code(409).send({
        error: {
          code: "NO_CLAIMABLE_BALANCE",
          message: "Provider has no claimable on-chain balance"
        }
      });
    }

    const requestedAmountAtomic = input.amountAtomic ? BigInt(input.amountAtomic) : claimableAtomic;
    if (requestedAmountAtomic <= 0n || requestedAmountAtomic > claimableAtomic) {
      return reply.code(402).send({
        error: {
          code: "INVALID_CLAIM_AMOUNT",
          message: "Claim amount exceeds provider claimable balance",
          requestedAtomic: requestedAmountAtomic.toString(),
          claimableAtomic: claimableAtomic.toString()
        }
      });
    }

    const runtimeConfig = loadSharedRuntimeConfig();

    return reply.code(200).send({
      ...prepareClaimProviderEarningsCall({
        contractAddress: requireEnv("MX402_LEDGER_CONTRACT"),
        chainId: runtimeConfig.chainId,
        providerId: provider.id,
        amountAtomic: requestedAmountAtomic.toString()
      }),
      providerId: provider.id,
      payoutWalletAddress: provider.payout_wallet_address,
      claimableAtomic: claimableAtomic.toString()
    });
  });

  app.post("/v1/providers/me/claim/track", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const input = trackProviderClaimSchema.parse(request.body);
    const prisma = getPrismaClient();
    const provider = await prisma.provider.findUnique({
      where: {
        user_id: auth.userId
      }
    });

    if (!provider) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Provider profile not found"
        }
      });
    }

    const tracked = await trackProviderClaimTransaction({
      txHash: input.txHash,
      walletAddress: auth.walletAddress,
      providerId: provider.id,
      amountAtomic: input.amountAtomic
    });

    return reply.code(202).send({
      txHash: tracked.tx_hash,
      status: tracked.status,
      txKind: tracked.tx_kind
    });
  });

  app.post("/v1/providers/me/claim/refresh", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const prisma = getPrismaClient();
    const provider = await prisma.provider.findUnique({
      where: {
        user_id: auth.userId
      },
      include: {
        balance: true
      }
    });

    if (!provider) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Provider profile not found"
        }
      });
    }

    const confirmation = await confirmSubmittedProviderClaims(claimRefreshLogger);
    const refreshed = await prisma.provider.findUniqueOrThrow({
      where: {
        id: provider.id
      },
      include: {
        balance: true
      }
    });

    return reply.code(200).send({
      confirmation,
      balances: {
        unsettledEarnedAtomic: refreshed.balance?.unsettled_earned_atomic.toString() ?? "0",
        claimableOnchainAtomic: refreshed.balance?.claimable_onchain_atomic.toString() ?? "0",
        claimedTotalAtomic: refreshed.balance?.claimed_total_atomic.toString() ?? "0"
      }
    });
  });
}
