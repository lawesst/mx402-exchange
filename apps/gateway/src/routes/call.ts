import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyReply } from "fastify";

import { loadSharedRuntimeConfig, optionalEnv } from "@mx402/config";
import { Prisma, getPrismaClient } from "@mx402/db";
import { atomicToString, computeSpendableAtomic, gatewayCallSchema } from "@mx402/domain";

type BuyerBalanceRow = {
  asset_identifier: string;
  onchain_confirmed_atomic: Prisma.Decimal;
  reserved_atomic: Prisma.Decimal;
  consumed_unsettled_atomic: Prisma.Decimal;
};

type CachedGatewayResponse = {
  statusCode: number;
  body: unknown;
  headers?: Record<string, string>;
};

type GatewayActor = {
  apiKeyId: string;
  projectId: string;
  projectName: string;
  buyerUserId: string;
  buyerWalletAddress: string;
};

type ActiveProduct = {
  id: string;
  slug: string;
  name: string;
  priceAtomic: string;
  baseUrl: string;
  upstreamPathTemplate: string;
  upstreamMethod: "GET" | "POST";
  timeoutMs: number;
  rateLimitPerMinute: number;
  originAuthMode: "none" | "static_header";
  originAuthHeaderName: string | null;
  originAuthSecret: string | null;
  providerId: string;
  providerSlug: string;
  providerName: string;
  providerPayoutWalletAddress: string;
};

class HttpError extends Error {
  statusCode: number;
  body: Record<string, unknown>;

  constructor(statusCode: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.body = {
      error: {
        code,
        message,
        ...(extra ?? {})
      }
    };
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  return `{${entries
    .map(([key, childValue]) => `${JSON.stringify(key)}:${stableStringify(childValue)}`)
    .join(",")}}`;
}

function serializeBalance(balance: BuyerBalanceRow) {
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

function parseBearerApiKey(headerValue?: string): string {
  if (!headerValue) {
    throw new HttpError(401, "INVALID_API_KEY", "API key is invalid or revoked");
  }

  const [scheme, token] = headerValue.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    throw new HttpError(401, "INVALID_API_KEY", "API key is invalid or revoked");
  }

  return token.trim();
}

function createPublicReceiptId() {
  return `rcpt_${randomBytes(10).toString("hex")}`;
}

function parseCachedResponse(value: Prisma.JsonValue | null): CachedGatewayResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const payload = value as Record<string, unknown>;
  if (typeof payload.statusCode !== "number") {
    return null;
  }

  return {
    statusCode: payload.statusCode,
    body: payload.body,
    headers:
      payload.headers && typeof payload.headers === "object" && !Array.isArray(payload.headers)
        ? (payload.headers as Record<string, string>)
        : undefined
  };
}

function replyFromCachedResponse(reply: FastifyReply, cachedResponse: CachedGatewayResponse) {
  for (const [headerName, headerValue] of Object.entries(cachedResponse.headers ?? {})) {
    reply.header(headerName, headerValue);
  }

  return reply.code(cachedResponse.statusCode).send(cachedResponse.body);
}

function renderUpstreamPath(template: string, pathParams: Record<string, string>) {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
    const value = pathParams[key];
    if (!value) {
      throw new HttpError(422, "INVALID_INPUT", `Missing path parameter: ${key}`);
    }

    return encodeURIComponent(value);
  });
}

function buildUpstreamUrl(input: {
  baseUrl: string;
  upstreamPathTemplate: string;
  pathParams: Record<string, string>;
  query: Record<string, string | number | boolean>;
}) {
  const url = new URL(renderUpstreamPath(input.upstreamPathTemplate, input.pathParams), input.baseUrl);

  for (const [key, value] of Object.entries(input.query)) {
    url.searchParams.set(key, String(value));
  }

  return url;
}

function parseUpstreamBody(rawBody: string, contentType: string | null) {
  if (!rawBody) {
    return null;
  }

  if (contentType?.includes("application/json")) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return rawBody;
    }
  }

  return rawBody;
}

function buildGatewayHeaders(input: {
  receiptId: string;
  chargedAtomic: string;
  balanceRemainingAtomic: string;
}) {
  return {
    "X-MX402-Receipt-Id": input.receiptId,
    "X-MX402-Charged-Atomic": input.chargedAtomic,
    "X-MX402-Balance-Remaining-Atomic": input.balanceRemainingAtomic
  };
}

export async function registerGatewayRoutes(app: FastifyInstance) {
  app.post("/v1/gateway/products/:productId/call", async (request, reply) => {
    const runtimeConfig = loadSharedRuntimeConfig();
    const prisma = getPrismaClient();
    const { productId } = request.params as { productId: string };
    const input = gatewayCallSchema.parse(request.body);
    const idempotencyKey = request.headers["idempotency-key"]?.toString().trim() || null;
    const authorization = request.headers.authorization;
    const requestHash = sha256(
      stableStringify({
        productId,
        pathParams: input.pathParams,
        query: input.query,
        body: input.body ?? null
      })
    );
    const apiKey = parseBearerApiKey(authorization);
    const apiKeyHash = sha256(apiKey);

    const apiKeyRecord = await prisma.projectApiKey.findFirst({
      where: {
        secret_hash: apiKeyHash,
        status: "active",
        revoked_at: null,
        project: {
          status: "active"
        }
      },
      include: {
        project: {
          include: {
            user: true
          }
        }
      }
    });

    if (!apiKeyRecord) {
      throw new HttpError(401, "INVALID_API_KEY", "API key is invalid or revoked");
    }

    const productRecord = await prisma.providerProduct.findFirst({
      where: {
        id: productId,
        status: "active",
        provider: {
          status: "approved"
        }
      },
      include: {
        provider: true
      }
    });

    if (!productRecord) {
      throw new HttpError(404, "NOT_FOUND", "Product not found");
    }

    const actor: GatewayActor = {
      apiKeyId: apiKeyRecord.id,
      projectId: apiKeyRecord.project_id,
      projectName: apiKeyRecord.project.name,
      buyerUserId: apiKeyRecord.project.user_id,
      buyerWalletAddress: apiKeyRecord.project.user.wallet_address
    };

    const product: ActiveProduct = {
      id: productRecord.id,
      slug: productRecord.slug,
      name: productRecord.name,
      priceAtomic: productRecord.price_atomic.toString(),
      baseUrl: productRecord.base_url,
      upstreamPathTemplate: productRecord.upstream_path_template,
      upstreamMethod: productRecord.upstream_method,
      timeoutMs: productRecord.timeout_ms,
      rateLimitPerMinute: productRecord.rate_limit_per_minute,
      originAuthMode: productRecord.origin_auth_mode,
      originAuthHeaderName: productRecord.origin_auth_header_name,
      originAuthSecret: productRecord.origin_auth_secret_ciphertext,
      providerId: productRecord.provider.id,
      providerSlug: productRecord.provider.slug,
      providerName: productRecord.provider.display_name,
      providerPayoutWalletAddress: productRecord.provider.payout_wallet_address
    };

    const activeGrant = await prisma.projectProductGrant.findFirst({
      where: {
        project_id: actor.projectId,
        product_id: product.id,
        status: "active",
        revoked_at: null
      }
    });

    if (!activeGrant) {
      throw new HttpError(403, "PRODUCT_NOT_GRANTED", "This project is not allowed to call the selected product");
    }

    const reservationTtlMs = Number(optionalEnv("GATEWAY_RESERVATION_TTL_SECONDS", "300")) * 1000;
    const idempotencyTtlMs = Number(optionalEnv("GATEWAY_RESPONSE_CACHE_TTL_SECONDS", "86400")) * 1000;
    const reservationExpiresAt = new Date(Date.now() + reservationTtlMs);
    const idempotencyExpiresAt = new Date(Date.now() + idempotencyTtlMs);
    const priceDecimal = new Prisma.Decimal(product.priceAtomic);
    const gatewayRequestId = randomUUID();

    let cachedResponse: CachedGatewayResponse | null = null;
    let reservationId = "";

    try {
      const reservationResult = await prisma.$transaction(
        async (tx) => {
          if (idempotencyKey) {
            const existingIdempotency = await tx.gatewayIdempotencyKey.findFirst({
              where: {
                project_id: actor.projectId,
                product_id: product.id,
                idempotency_key: idempotencyKey
              }
            });

            if (existingIdempotency) {
              if (existingIdempotency.request_hash !== requestHash) {
                throw new HttpError(
                  409,
                  "IDEMPOTENCY_MISMATCH",
                  "This idempotency key was already used for a different request"
                );
              }

              const parsedResponse = parseCachedResponse(existingIdempotency.response_cache_json);
              if (parsedResponse) {
                cachedResponse = parsedResponse;
                return null;
              }

              if (existingIdempotency.status === "processing") {
                throw new HttpError(409, "IDEMPOTENCY_IN_PROGRESS", "This idempotent request is still being processed");
              }
            } else {
              await tx.gatewayIdempotencyKey.create({
                data: {
                  project_id: actor.projectId,
                  product_id: product.id,
                  api_key_id: actor.apiKeyId,
                  idempotency_key: idempotencyKey,
                  request_hash: requestHash,
                  status: "processing",
                  expires_at: idempotencyExpiresAt
                }
              });
            }
          }

          const updatedBalances = await tx.$queryRaw<BuyerBalanceRow[]>(Prisma.sql`
            UPDATE buyer_balances
            SET reserved_atomic = reserved_atomic + ${priceDecimal},
                updated_at = NOW()
            WHERE user_id = ${actor.buyerUserId}::uuid
              AND (onchain_confirmed_atomic - reserved_atomic - consumed_unsettled_atomic) >= ${priceDecimal}
            RETURNING asset_identifier, onchain_confirmed_atomic, reserved_atomic, consumed_unsettled_atomic
          `);

          if (updatedBalances.length === 0) {
            const currentBalance = await tx.buyerBalance.findUnique({
              where: {
                user_id: actor.buyerUserId
              }
            });

            const spendableAtomic = currentBalance
              ? computeSpendableAtomic({
                  onchainConfirmedAtomic: currentBalance.onchain_confirmed_atomic,
                  reservedAtomic: currentBalance.reserved_atomic,
                  consumedUnsettledAtomic: currentBalance.consumed_unsettled_atomic
                })
              : "0";

            throw new HttpError(402, "INSUFFICIENT_BALANCE", "Insufficient spendable balance for this request", {
              productId: product.id,
              assetIdentifier: runtimeConfig.assetIdentifier,
              requiredAtomic: product.priceAtomic,
              availableAtomic: spendableAtomic,
              topUpUrl: "/billing/top-up"
            });
          }

          const reservation = await tx.usageReservation.create({
            data: {
              gateway_request_id: gatewayRequestId,
              project_id: actor.projectId,
              product_id: product.id,
              api_key_id: actor.apiKeyId,
              buyer_user_id: actor.buyerUserId,
              amount_atomic: priceDecimal,
              upstream_method: product.upstreamMethod,
              upstream_path: renderUpstreamPath(product.upstreamPathTemplate, input.pathParams),
              expires_at: reservationExpiresAt
            }
          });

          return {
            reservationId: reservation.id,
            balance: updatedBalances[0]
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }
      );

      if (cachedResponse) {
        return replyFromCachedResponse(reply, cachedResponse);
      }

      if (!reservationResult) {
        throw new HttpError(409, "IDEMPOTENCY_IN_PROGRESS", "Unable to continue idempotent request");
      }

      reservationId = reservationResult.reservationId;

      const upstreamUrl = buildUpstreamUrl({
        baseUrl: product.baseUrl,
        upstreamPathTemplate: product.upstreamPathTemplate,
        pathParams: input.pathParams,
        query: input.query
      });
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), product.timeoutMs);
      const serializedBody =
        product.upstreamMethod === "POST" && input.body !== undefined ? JSON.stringify(input.body) : undefined;
      const upstreamHeaders: Record<string, string> = {};

      if (product.originAuthMode === "static_header" && product.originAuthHeaderName && product.originAuthSecret) {
        upstreamHeaders[product.originAuthHeaderName] = product.originAuthSecret;
      }

      if (serializedBody) {
        upstreamHeaders["content-type"] = "application/json";
      }

      let upstreamResponse: Response;

      try {
        upstreamResponse = await fetch(upstreamUrl, {
          method: product.upstreamMethod,
          headers: upstreamHeaders,
          body: serializedBody,
          signal: controller.signal
        });
      } catch (error) {
        clearTimeout(timeoutId);

        const durationMs = Date.now() - startedAt;
        const requestBytes = serializedBody ? Buffer.byteLength(serializedBody) : 0;
        const responseBody = {
          error: {
            code: error instanceof Error && error.name === "AbortError" ? "UPSTREAM_TIMEOUT" : "UPSTREAM_ERROR",
            message:
              error instanceof Error && error.name === "AbortError"
                ? "Provider request timed out"
                : "Provider request failed",
            charged: false
          }
        };

        await prisma.$transaction(async (tx) => {
          await tx.usageReservation.update({
            where: {
              id: reservationId
            },
            data: {
              status: "released",
              released_at: new Date()
            }
          });

          await tx.$executeRaw(Prisma.sql`
            UPDATE buyer_balances
            SET reserved_atomic = GREATEST(reserved_atomic - ${priceDecimal}, 0),
                updated_at = NOW()
            WHERE user_id = ${actor.buyerUserId}::uuid
          `);

          await tx.usageEvent.create({
            data: {
              reservation_id: reservationId,
              project_id: actor.projectId,
              product_id: product.id,
              provider_id: product.providerId,
              api_key_id: actor.apiKeyId,
              buyer_user_id: actor.buyerUserId,
              amount_atomic: priceDecimal,
              request_status: error instanceof Error && error.name === "AbortError" ? "timeout" : "upstream_error",
              upstream_status_code: null,
              upstream_latency_ms: durationMs,
              request_bytes: requestBytes,
              response_bytes: 0,
              charged: false
            }
          });

          await tx.projectApiKey.update({
            where: {
              id: actor.apiKeyId
            },
            data: {
              last_used_at: new Date()
            }
          });

          if (idempotencyKey) {
            await tx.gatewayIdempotencyKey.updateMany({
              where: {
                project_id: actor.projectId,
                product_id: product.id,
                idempotency_key: idempotencyKey,
                request_hash: requestHash
              },
              data: {
                status: "failed",
                response_cache_json: {
                  statusCode: error instanceof Error && error.name === "AbortError" ? 504 : 502,
                  headers: {},
                  body: responseBody
                }
              }
            });
          }
        });

        return reply
          .code(error instanceof Error && error.name === "AbortError" ? 504 : 502)
          .send(responseBody);
      }

      clearTimeout(timeoutId);

      const rawUpstreamBody = await upstreamResponse.text();
      const upstreamData = parseUpstreamBody(rawUpstreamBody, upstreamResponse.headers.get("content-type"));
      const durationMs = Date.now() - startedAt;
      const requestBytes = serializedBody ? Buffer.byteLength(serializedBody) : 0;
      const responseBytes = rawUpstreamBody ? Buffer.byteLength(rawUpstreamBody) : 0;

      if (!upstreamResponse.ok) {
        const failureBody = {
          error: {
            code: "UPSTREAM_ERROR",
            message: "Provider request failed",
            charged: false,
            providerStatus: upstreamResponse.status
          }
        };

        await prisma.$transaction(async (tx) => {
          await tx.usageReservation.update({
            where: {
              id: reservationId
            },
            data: {
              status: "released",
              released_at: new Date()
            }
          });

          await tx.$executeRaw(Prisma.sql`
            UPDATE buyer_balances
            SET reserved_atomic = GREATEST(reserved_atomic - ${priceDecimal}, 0),
                updated_at = NOW()
            WHERE user_id = ${actor.buyerUserId}::uuid
          `);

          await tx.usageEvent.create({
            data: {
              reservation_id: reservationId,
              project_id: actor.projectId,
              product_id: product.id,
              provider_id: product.providerId,
              api_key_id: actor.apiKeyId,
              buyer_user_id: actor.buyerUserId,
              amount_atomic: priceDecimal,
              request_status: "upstream_error",
              upstream_status_code: upstreamResponse.status,
              upstream_latency_ms: durationMs,
              request_bytes: requestBytes,
              response_bytes: responseBytes,
              charged: false
            }
          });

          await tx.projectApiKey.update({
            where: {
              id: actor.apiKeyId
            },
            data: {
              last_used_at: new Date()
            }
          });

          if (idempotencyKey) {
            await tx.gatewayIdempotencyKey.updateMany({
              where: {
                project_id: actor.projectId,
                product_id: product.id,
                idempotency_key: idempotencyKey,
                request_hash: requestHash
              },
              data: {
                status: "failed",
                response_cache_json: {
                  statusCode: 502,
                  headers: {},
                  body: failureBody
                }
              }
            });
          }
        });

        return reply.code(502).send(failureBody);
      }

      const settled = await prisma.$transaction(
        async (tx) => {
          await tx.usageReservation.update({
            where: {
              id: reservationId
            },
            data: {
              status: "finalized",
              finalized_at: new Date()
            }
          });

          await tx.$executeRaw(Prisma.sql`
            UPDATE buyer_balances
            SET reserved_atomic = GREATEST(reserved_atomic - ${priceDecimal}, 0),
                consumed_unsettled_atomic = consumed_unsettled_atomic + ${priceDecimal},
                updated_at = NOW()
            WHERE user_id = ${actor.buyerUserId}::uuid
          `);

          const usageEvent = await tx.usageEvent.create({
            data: {
              reservation_id: reservationId,
              project_id: actor.projectId,
              product_id: product.id,
              provider_id: product.providerId,
              api_key_id: actor.apiKeyId,
              buyer_user_id: actor.buyerUserId,
              amount_atomic: priceDecimal,
              request_status: "success",
              upstream_status_code: upstreamResponse.status,
              upstream_latency_ms: durationMs,
              request_bytes: requestBytes,
              response_bytes: responseBytes,
              charged: true
            }
          });

          const providerBalance = await tx.providerBalance.upsert({
            where: {
              provider_id: product.providerId
            },
            update: {
              unsettled_earned_atomic: {
                increment: priceDecimal
              }
            },
            create: {
              provider_id: product.providerId,
              unsettled_earned_atomic: priceDecimal
            }
          });

          const receipt = await tx.usageReceipt.create({
            data: {
              usage_event_id: usageEvent.id,
              public_receipt_id: createPublicReceiptId(),
              asset_identifier: runtimeConfig.assetIdentifier,
              amount_atomic: priceDecimal,
              buyer_wallet_address: actor.buyerWalletAddress,
              provider_wallet_address: product.providerPayoutWalletAddress,
              product_snapshot: {
                id: product.id,
                slug: product.slug,
                name: product.name,
                providerId: product.providerId,
                providerSlug: product.providerSlug,
                providerName: product.providerName,
                upstreamMethod: product.upstreamMethod
              }
            }
          });

          const updatedBalanceRows = await tx.$queryRaw<BuyerBalanceRow[]>(Prisma.sql`
            SELECT asset_identifier, onchain_confirmed_atomic, reserved_atomic, consumed_unsettled_atomic
            FROM buyer_balances
            WHERE user_id = ${actor.buyerUserId}::uuid
            LIMIT 1
          `);

          await tx.projectApiKey.update({
            where: {
              id: actor.apiKeyId
            },
            data: {
              last_used_at: new Date()
            }
          });

          const balance = updatedBalanceRows[0];
          const serializedBalance = serializeBalance(balance);
          const successBody = {
            receiptId: receipt.public_receipt_id,
            productId: product.id,
            assetIdentifier: runtimeConfig.assetIdentifier,
            chargedAtomic: product.priceAtomic,
            balanceRemainingAtomic: serializedBalance.spendableAtomic,
            providerStatus: upstreamResponse.status,
            durationMs,
            data: upstreamData
          };
          const successHeaders = buildGatewayHeaders({
            receiptId: receipt.public_receipt_id,
            chargedAtomic: product.priceAtomic,
            balanceRemainingAtomic: serializedBalance.spendableAtomic
          });

          if (idempotencyKey) {
            await tx.gatewayIdempotencyKey.updateMany({
              where: {
                project_id: actor.projectId,
                product_id: product.id,
                idempotency_key: idempotencyKey,
                request_hash: requestHash
              },
              data: {
                status: "completed",
                usage_receipt_id: receipt.id,
                response_cache_json: {
                  statusCode: 200,
                  headers: successHeaders,
                  body: successBody
                }
              }
            });
          }

          return {
            successBody,
            successHeaders,
            providerBalance
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }
      );

      for (const [headerName, headerValue] of Object.entries(settled.successHeaders)) {
        reply.header(headerName, headerValue);
      }

      return reply.code(200).send(settled.successBody);
    } catch (error) {
      if (error instanceof HttpError) {
        return reply.code(error.statusCode).send(error.body);
      }

      throw error;
    }
  });
}
