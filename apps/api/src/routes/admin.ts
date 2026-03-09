import type { FastifyInstance } from "fastify";

import { notImplemented } from "../http.js";

export async function registerAdminRoutes(app: FastifyInstance) {
  app.get("/v1/admin/providers", async (_request, reply) => {
    return notImplemented(reply, "GET /v1/admin/providers");
  });

  app.post("/v1/admin/providers/:providerId/approve", async (_request, reply) => {
    return notImplemented(reply, "POST /v1/admin/providers/:providerId/approve");
  });

  app.post("/v1/admin/providers/:providerId/reject", async (_request, reply) => {
    return notImplemented(reply, "POST /v1/admin/providers/:providerId/reject");
  });

  app.post("/v1/admin/products/:productId/activate", async (_request, reply) => {
    return notImplemented(reply, "POST /v1/admin/products/:productId/activate");
  });

  app.post("/v1/admin/products/:productId/pause", async (_request, reply) => {
    return notImplemented(reply, "POST /v1/admin/products/:productId/pause");
  });

  app.get("/v1/admin/settlement-batches", async (_request, reply) => {
    return notImplemented(reply, "GET /v1/admin/settlement-batches");
  });

  app.post("/v1/admin/settlement-batches/:batchId/retry", async (_request, reply) => {
    return notImplemented(reply, "POST /v1/admin/settlement-batches/:batchId/retry");
  });
}
