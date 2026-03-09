import type { FastifyInstance } from "fastify";

import { notImplemented } from "../http.js";

export async function registerProductRoutes(app: FastifyInstance) {
  app.get("/v1/products", async () => ({
    data: [],
    nextCursor: null
  }));

  app.get("/v1/products/:productId", async (_request, reply) => {
    return notImplemented(reply, "GET /v1/products/:productId");
  });
}
