import Fastify from "fastify";

import { createLogger } from "@mx402/observability";

import { registerGatewayRoutes } from "./routes/call.js";

export function buildGatewayApp() {
  const logger = createLogger("gateway");
  const app = Fastify();

  app.get("/health", async () => ({
    ok: true,
    service: "gateway"
  }));

  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : "Unexpected error";

    logger.error("Gateway request failed", {
      message
    });

    reply.code(400).send({
      error: {
        code: "BAD_REQUEST",
        message
      }
    });
  });

  app.register(registerGatewayRoutes);

  return app;
}
