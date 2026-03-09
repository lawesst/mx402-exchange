import cookie from "@fastify/cookie";
import Fastify from "fastify";

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

export function buildApp() {
  const logger = createLogger("api");
  const app = Fastify();

  app.register(cookie, {
    secret: process.env.SESSION_SIGNING_SECRET
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
