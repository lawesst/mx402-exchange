import type { FastifyInstance } from "fastify";

import { createProductSchema, createProviderSchema } from "@mx402/domain";

import { notImplemented } from "../http.js";

export async function registerProviderRoutes(app: FastifyInstance) {
  app.post("/v1/providers", async (request, reply) => {
    createProviderSchema.parse(request.body);
    return notImplemented(reply, "POST /v1/providers");
  });

  app.get("/v1/providers/me", async (_request, reply) => {
    return notImplemented(reply, "GET /v1/providers/me");
  });

  app.patch("/v1/providers/me", async (_request, reply) => {
    return notImplemented(reply, "PATCH /v1/providers/me");
  });

  app.post("/v1/providers/me/products", async (request, reply) => {
    createProductSchema.parse(request.body);
    return notImplemented(reply, "POST /v1/providers/me/products");
  });

  app.get("/v1/providers/me/products", async (_request, reply) => {
    return notImplemented(reply, "GET /v1/providers/me/products");
  });

  app.get("/v1/providers/me/products/:productId", async (_request, reply) => {
    return notImplemented(reply, "GET /v1/providers/me/products/:productId");
  });

  app.patch("/v1/providers/me/products/:productId", async (_request, reply) => {
    return notImplemented(reply, "PATCH /v1/providers/me/products/:productId");
  });

  app.post("/v1/providers/me/products/:productId/submit", async (_request, reply) => {
    return notImplemented(reply, "POST /v1/providers/me/products/:productId/submit");
  });

  app.get("/v1/providers/me/earnings", async (_request, reply) => {
    return notImplemented(reply, "GET /v1/providers/me/earnings");
  });

  app.post("/v1/providers/me/claim/prepare", async (_request, reply) => {
    return notImplemented(reply, "POST /v1/providers/me/claim/prepare");
  });
}
