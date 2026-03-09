import type { FastifyInstance } from "fastify";

import { getPrismaClient } from "@mx402/db";
import { nativeAuthLoginSchema } from "@mx402/domain";

import { clearSessionCookie, createSession, loadSession, resolveLoginIdentity, revokeCurrentSession, setSessionCookie } from "../auth.js";
import { ensureBuyerBalance, serializeBuyerBalance } from "../balance.js";

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post("/v1/auth/native-auth/login", async (request, reply) => {
    const input = nativeAuthLoginSchema.parse(request.body);
    const identity = await resolveLoginIdentity(input);
    const session = await createSession({
      walletAddress: identity.walletAddress,
      displayName: input.displayName,
      nativeAuthToken: identity.nativeAuthToken
    });
    const balance = await ensureBuyerBalance(session.user.id);

    setSessionCookie(reply, session.sessionToken, session.expiresAt);

    return reply.code(200).send({
      user: {
        id: session.user.id,
        walletAddress: session.user.wallet_address,
        displayName: session.user.display_name,
        isAdmin: session.user.is_admin
      },
      balance: serializeBuyerBalance(balance),
      authMode: identity.authMode,
      expiresAt: session.expiresAt.toISOString()
    });
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    await revokeCurrentSession(request);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get("/v1/me", async (request, reply) => {
    const auth = await loadSession(request);
    if (!auth) {
      return reply.code(401).send({
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required"
        }
      });
    }

    const prisma = getPrismaClient();
    const user = await prisma.user.findUniqueOrThrow({
      where: {
        id: auth.userId
      },
      include: {
        provider: {
          select: {
            id: true,
            slug: true,
            status: true,
            display_name: true
          }
        },
        buyerBalance: true
      }
    });

    return reply.code(200).send({
      user: {
        id: user.id,
        walletAddress: user.wallet_address,
        displayName: user.display_name,
        isAdmin: user.is_admin
      },
      provider: user.provider ? {
        id: user.provider.id,
        slug: user.provider.slug,
        status: user.provider.status,
        displayName: user.provider.display_name
      } : null,
      balance: user.buyerBalance ? serializeBuyerBalance(user.buyerBalance) : null
    });
  });
}
