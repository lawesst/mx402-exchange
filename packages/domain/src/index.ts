import { z } from "zod";

export const amountSchema = z.string().regex(/^[0-9]+$/, "Amount must be an atomic-unit string");

export const providerStatusSchema = z.enum(["pending", "approved", "rejected", "suspended"]);
export const productStatusSchema = z.enum(["draft", "pending_review", "active", "paused", "archived"]);
export const projectStatusSchema = z.enum(["active", "suspended", "archived"]);
export const apiKeyStatusSchema = z.enum(["active", "revoked"]);

export const prepareDepositSchema = z.object({
  amountAtomic: amountSchema
});

export const nativeAuthLoginSchema = z.object({
  nativeAuthToken: z.string().min(1).optional(),
  walletAddress: z.string().regex(/^erd1[0-9a-z]+$/i).optional(),
  displayName: z.string().min(1).max(80).optional()
}).superRefine((value, ctx) => {
  if (!value.nativeAuthToken && !value.walletAddress) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Either nativeAuthToken or walletAddress must be provided"
    });
  }
});

export const createProviderSchema = z.object({
  slug: z.string().min(3).max(64).regex(/^[a-z0-9-]+$/),
  displayName: z.string().min(2).max(120),
  description: z.string().max(5000).optional(),
  websiteUrl: z.string().url().optional(),
  payoutWalletAddress: z.string().min(8).max(80)
});

export const createProductSchema = z.object({
  slug: z.string().min(3).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().min(2).max(120),
  shortDescription: z.string().min(2).max(240),
  description: z.string().max(10000).optional(),
  baseUrl: z.string().url(),
  upstreamPathTemplate: z.string().min(1).max(255),
  upstreamMethod: z.enum(["GET", "POST"]),
  priceAtomic: amountSchema,
  timeoutMs: z.number().int().min(1000).max(30000).default(10000),
  rateLimitPerMinute: z.number().int().min(1).max(10000).default(60),
  originAuthMode: z.enum(["none", "static_header"]).default("none"),
  originAuthHeaderName: z.string().max(64).optional(),
  originAuthSecret: z.string().optional(),
  pathParamsSchemaJson: z.record(z.unknown()).default({}),
  inputSchemaJson: z.record(z.unknown()).default({}),
  querySchemaJson: z.record(z.unknown()).default({}),
  outputSchemaJson: z.record(z.unknown()).default({})
}).superRefine((value, ctx) => {
  if (value.originAuthMode === "static_header") {
    if (!value.originAuthHeaderName || !value.originAuthSecret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Static header auth requires both header name and secret"
      });
    }
  }
});

export const createProjectSchema = z.object({
  name: z.string().min(2).max(120)
});

export const createApiKeySchema = z.object({
  name: z.string().min(2).max(120)
});

export const createGrantSchema = z.object({
  productId: z.string().uuid()
});

export const trackDepositSchema = z.object({
  txHash: z.string().min(10).max(80),
  amountAtomic: amountSchema.optional()
});

export const gatewayCallSchema = z.object({
  pathParams: z.record(z.string()).default({}),
  query: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  body: z.unknown().nullable().optional()
});

export function atomicToBigInt(value: bigint | number | string | { toString(): string }): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    return BigInt(value);
  }

  return BigInt(value.toString());
}

export function atomicToString(value: bigint | number | string | { toString(): string }): string {
  return atomicToBigInt(value).toString();
}

export function computeSpendableAtomic(input: {
  onchainConfirmedAtomic: bigint | number | string | { toString(): string };
  reservedAtomic: bigint | number | string | { toString(): string };
  consumedUnsettledAtomic: bigint | number | string | { toString(): string };
}): string {
  const spendable =
    atomicToBigInt(input.onchainConfirmedAtomic) -
    atomicToBigInt(input.reservedAtomic) -
    atomicToBigInt(input.consumedUnsettledAtomic);

  return (spendable > 0n ? spendable : 0n).toString();
}

export type CreateProviderInput = z.infer<typeof createProviderSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type CreateGrantInput = z.infer<typeof createGrantSchema>;
export type GatewayCallInput = z.infer<typeof gatewayCallSchema>;
export type NativeAuthLoginInput = z.infer<typeof nativeAuthLoginSchema>;
export type TrackDepositInput = z.infer<typeof trackDepositSchema>;
