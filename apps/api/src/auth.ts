import { createHash, randomBytes } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import { getPrismaClient } from "@mx402/db";
import { loadSharedRuntimeConfig, optionalEnv } from "@mx402/config";
import { Address } from "@multiversx/sdk-core";
import { NativeAuthServer } from "@multiversx/sdk-native-auth-server";

const SESSION_COOKIE_NAME = "mx402_session";
const SESSION_TTL_SECONDS = Number(optionalEnv("SESSION_TTL_SECONDS", "604800"));

type LoginIdentity = {
  walletAddress: string;
  authMode: "native-auth";
  nativeAuthToken: string | null;
};

type NativeAuthValidationResult = {
  address?: string;
};

type NativeAuthDecodedResult = {
  address: string;
  body: string;
  signature: string;
  origin: string;
  ttl: number;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function getBootstrapAdminWallets() {
  return optionalEnv("MX402_BOOTSTRAP_ADMIN_WALLETS", "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function getNativeAuthServer() {
  const apiUrl = optionalEnv("MULTIVERSX_API_URL", "https://api.multiversx.com");
  const acceptedOrigins = optionalEnv("NATIVE_AUTH_ALLOWED_ORIGINS", "*")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const maxExpirySeconds = Number(optionalEnv("NATIVE_AUTH_MAX_EXPIRY_SECONDS", "86400"));

  return new NativeAuthServer({
    apiUrl,
    acceptedOrigins,
    maxExpirySeconds
  });
}

function allowInsecureNativeAuthDevFallback() {
  const fallback = optionalEnv("MX402_ENV", "development") === "development" ? "true" : "false";
  return optionalEnv("NATIVE_AUTH_DEV_ALLOW_BLOCK_HASH_BYPASS", fallback) === "true";
}

function isWalletAddress(value: string): boolean {
  return /^erd1[0-9a-z]+$/i.test(value);
}

async function resolveLoginIdentityWithDevFallback(
  server: NativeAuthServer,
  nativeAuthToken: string
): Promise<LoginIdentity> {
  const fallbackServer = server as any as {
    config: {
      maxExpirySeconds: number;
      skipLegacyValidation?: boolean;
    };
    decode: (token: string) => NativeAuthDecodedResult;
    isOriginAccepted: (origin: string) => Promise<boolean>;
    verifySignature: (address: Address, message: string, signature: Buffer) => Promise<boolean>;
  };

  const decoded = fallbackServer.decode(nativeAuthToken);

  if (!decoded.address || !isWalletAddress(decoded.address)) {
    throw new Error("Native Auth validation did not return a valid wallet address");
  }

  if (decoded.ttl > fallbackServer.config.maxExpirySeconds) {
    throw new Error("Native Auth token TTL exceeds server limits");
  }

  const isAcceptedOrigin = await fallbackServer.isOriginAccepted(decoded.origin);
  if (!isAcceptedOrigin) {
    throw new Error("Native Auth token origin is not accepted");
  }

  const address = new Address(decoded.address);
  const signature = Buffer.from(decoded.signature, "hex");
  const signedMessage = `${decoded.address}${decoded.body}`;
  let isValidSignature = await fallbackServer.verifySignature(address, signedMessage, signature);

  if (!isValidSignature && !fallbackServer.config.skipLegacyValidation) {
    const legacySignedMessage = `${decoded.address}${decoded.body}{}`;
    isValidSignature = await fallbackServer.verifySignature(address, legacySignedMessage, signature);
  }

  if (!isValidSignature) {
    throw new Error("Native Auth signature validation failed");
  }

  console.warn("[mx402] Using development Native Auth fallback: skipping block hash validation");

  return {
    walletAddress: decoded.address,
    authMode: "native-auth",
    nativeAuthToken
  };
}

export async function resolveLoginIdentity(input: {
  nativeAuthToken: string;
}): Promise<LoginIdentity> {
  const server = getNativeAuthServer();
  let validated: NativeAuthValidationResult;

  try {
    validated = await server.validate(input.nativeAuthToken) as NativeAuthValidationResult;
  } catch (error) {
    if (
      allowInsecureNativeAuthDevFallback() &&
      error instanceof Error &&
      error.message === "Invalid block hash"
    ) {
      return resolveLoginIdentityWithDevFallback(server, input.nativeAuthToken);
    }

    throw error;
  }

  if (!validated.address || !isWalletAddress(validated.address)) {
    throw new Error("Native Auth validation did not return a valid wallet address");
  }

  return {
    walletAddress: validated.address,
    authMode: "native-auth",
    nativeAuthToken: input.nativeAuthToken
  };
}

export async function createSession(input: {
  walletAddress: string;
  displayName?: string;
  nativeAuthToken: string | null;
}) {
  const prisma = getPrismaClient();
  const runtimeConfig = loadSharedRuntimeConfig();
  const sessionToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  const user = await prisma.user.upsert({
    where: {
      wallet_address: input.walletAddress
    },
    update: {
      display_name: input.displayName ?? undefined,
      is_admin: getBootstrapAdminWallets().includes(input.walletAddress) ? true : undefined
    },
    create: {
      wallet_address: input.walletAddress,
      display_name: input.displayName ?? null,
      is_admin: getBootstrapAdminWallets().includes(input.walletAddress)
    }
  });

  await prisma.buyerBalance.upsert({
    where: {
      user_id: user.id
    },
    update: {
      asset_identifier: runtimeConfig.assetIdentifier
    },
    create: {
      user_id: user.id,
      asset_identifier: runtimeConfig.assetIdentifier
    }
  });

  const session = await prisma.walletSession.create({
    data: {
      user_id: user.id,
      session_token_hash: sha256(sessionToken),
      native_auth_token_hash: sha256(input.nativeAuthToken ?? `dev:${input.walletAddress}`),
      expires_at: expiresAt,
      user_agent: null,
      ip_address: null
    }
  });

  return {
    sessionToken,
    sessionId: session.id,
    user,
    expiresAt
  };
}

export function setSessionCookie(reply: FastifyReply, sessionToken: string, expiresAt: Date) {
  reply.setCookie(SESSION_COOKIE_NAME, sessionToken, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: optionalEnv("MX402_ENV", "development") !== "development",
    expires: expiresAt
  });
}

export async function loadSession(request: FastifyRequest) {
  const sessionToken = request.cookies[SESSION_COOKIE_NAME];
  if (!sessionToken) {
    request.auth = null;
    return null;
  }

  const prisma = getPrismaClient();
  const session = await prisma.walletSession.findFirst({
    where: {
      session_token_hash: sha256(sessionToken),
      revoked_at: null,
      expires_at: {
        gt: new Date()
      }
    },
    include: {
      user: true
    }
  });

  if (!session) {
    request.auth = null;
    return null;
  }

  await prisma.walletSession.update({
    where: {
      id: session.id
    },
    data: {
      last_seen_at: new Date()
    }
  });

  request.auth = {
    sessionId: session.id,
    userId: session.user.id,
    walletAddress: session.user.wallet_address,
    displayName: session.user.display_name,
    isAdmin: session.user.is_admin
  };

  return request.auth;
}

export async function requireSession(request: FastifyRequest, reply: FastifyReply) {
  const auth = request.auth ?? (await loadSession(request));
  if (!auth) {
    reply.code(401).send({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required"
      }
    });

    return null;
  }

  return auth;
}

export async function requireAdminSession(request: FastifyRequest, reply: FastifyReply) {
  const auth = await requireSession(request, reply);
  if (!auth) {
    return null;
  }

  if (!auth.isAdmin) {
    reply.code(403).send({
      error: {
        code: "FORBIDDEN",
        message: "Admin access required"
      }
    });

    return null;
  }

  return auth;
}

export async function revokeCurrentSession(request: FastifyRequest) {
  const sessionToken = request.cookies[SESSION_COOKIE_NAME];
  if (!sessionToken) {
    return;
  }

  const prisma = getPrismaClient();
  await prisma.walletSession.updateMany({
    where: {
      session_token_hash: sha256(sessionToken),
      revoked_at: null
    },
    data: {
      revoked_at: new Date()
    }
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}
