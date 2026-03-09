import { createHash, randomBytes } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import { getPrismaClient } from "@mx402/db";
import { loadSharedRuntimeConfig, optionalEnv } from "@mx402/config";
import { NativeAuthServer } from "@multiversx/sdk-native-auth-server";

const SESSION_COOKIE_NAME = "mx402_session";
const SESSION_TTL_SECONDS = Number(optionalEnv("SESSION_TTL_SECONDS", "604800"));
const NATIVE_AUTH_SKIP_VERIFY = optionalEnv("NATIVE_AUTH_SKIP_VERIFY", "false") === "true";

type LoginIdentity = {
  walletAddress: string;
  authMode: "native-auth" | "development-bypass";
  nativeAuthToken: string | null;
};

type NativeAuthValidationResult = {
  address?: string;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

function isWalletAddress(value: string): boolean {
  return /^erd1[0-9a-z]+$/i.test(value);
}

export async function resolveLoginIdentity(input: {
  nativeAuthToken?: string;
  walletAddress?: string;
}): Promise<LoginIdentity> {
  if (NATIVE_AUTH_SKIP_VERIFY) {
    if (!input.walletAddress || !isWalletAddress(input.walletAddress)) {
      throw new Error("walletAddress is required when NATIVE_AUTH_SKIP_VERIFY=true");
    }

    return {
      walletAddress: input.walletAddress,
      authMode: "development-bypass",
      nativeAuthToken: input.nativeAuthToken ?? null
    };
  }

  if (!input.nativeAuthToken) {
    throw new Error("nativeAuthToken is required");
  }

  const server = getNativeAuthServer();
  const validated = await server.validate(input.nativeAuthToken) as NativeAuthValidationResult;

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
      display_name: input.displayName ?? undefined
    },
    create: {
      wallet_address: input.walletAddress,
      display_name: input.displayName ?? null
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
