import type { FastifyInstance } from "fastify";

import { notImplemented } from "../http.js";

export async function registerUsageRoutes(app: FastifyInstance) {
  app.get("/v1/usage/events", async (_request, reply) => {
    return notImplemented(reply, "GET /v1/usage/events");
  });

  app.get("/v1/usage/receipts/:receiptId", async (_request, reply) => {
    return notImplemented(reply, "GET /v1/usage/receipts/:receiptId");
  });
}
