import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import Fastify from "fastify";

import { optionalEnv } from "@mx402/config";
import { createLogger } from "@mx402/observability";
import { ZodError } from "zod";

import { registerAdminRoutes } from "./routes/admin.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerBalanceRoutes } from "./routes/balance.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerProductRoutes } from "./routes/products.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerProviderRoutes } from "./routes/providers.js";
import { registerUsageRoutes } from "./routes/usage.js";

function isAllowedOrigin(origin: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
    return true;
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }

  const normalizedLoopbackHost =
    parsedOrigin.hostname === "127.0.0.1" ? "localhost" : parsedOrigin.hostname;

  return allowedOrigins.some((allowedOrigin) => {
    let parsedAllowedOrigin: URL;
    try {
      parsedAllowedOrigin = new URL(allowedOrigin);
    } catch {
      return false;
    }

    const normalizedAllowedHost =
      parsedAllowedOrigin.hostname === "127.0.0.1" ? "localhost" : parsedAllowedOrigin.hostname;

    return (
      parsedOrigin.protocol === parsedAllowedOrigin.protocol &&
      normalizedLoopbackHost === normalizedAllowedHost &&
      parsedOrigin.port === parsedAllowedOrigin.port
    );
  });
}

export function buildApp() {
  const logger = createLogger("api");
  const app = Fastify();
  const allowedOrigins = optionalEnv("MX402_WEB_ORIGIN", "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.register(cookie, {
    secret: process.env.SESSION_SIGNING_SECRET
  });

  app.register(cors, {
    credentials: true,
    origin(origin, callback) {
      if (!origin || isAllowedOrigin(origin, allowedOrigins)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed"), false);
    }
  });

  app.decorateRequest("auth", null);

  app.addHook("onRequest", async (request) => {
    request.auth = null;
  });

  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : "Unexpected error";
    const stack = error instanceof Error ? error.stack : undefined;
    const statusCode = error instanceof ZodError ? 422 : 400;
    const errorCode = error instanceof ZodError ? "INVALID_INPUT" : "BAD_REQUEST";

    logger.error("Request failed", {
      message,
      stack
    });

    reply.code(statusCode).send({
      error: {
        code: errorCode,
        message
      }
    });
  });

  app.register(registerHealthRoutes);
  app.register(registerAuthRoutes);
  app.register(registerProductRoutes);
  app.register(registerProviderRoutes);
  app.register(registerProjectRoutes);
  app.register(registerBalanceRoutes);
  app.register(registerUsageRoutes);
  app.register(registerAdminRoutes);

  return app;
}
