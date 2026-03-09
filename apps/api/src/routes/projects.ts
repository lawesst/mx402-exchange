import type { FastifyInstance } from "fastify";

import { createApiKeySchema, createGrantSchema, createProjectSchema } from "@mx402/domain";

import { notImplemented } from "../http.js";

export async function registerProjectRoutes(app: FastifyInstance) {
  app.post("/v1/projects", async (request, reply) => {
    createProjectSchema.parse(request.body);
    return notImplemented(reply, "POST /v1/projects");
  });

  app.get("/v1/projects", async (_request, reply) => {
    return notImplemented(reply, "GET /v1/projects");
  });

  app.get("/v1/projects/:projectId", async (_request, reply) => {
    return notImplemented(reply, "GET /v1/projects/:projectId");
  });

  app.post("/v1/projects/:projectId/grants", async (request, reply) => {
    createGrantSchema.parse(request.body);
    return notImplemented(reply, "POST /v1/projects/:projectId/grants");
  });

  app.delete("/v1/projects/:projectId/grants/:productId", async (_request, reply) => {
    return notImplemented(reply, "DELETE /v1/projects/:projectId/grants/:productId");
  });

  app.post("/v1/projects/:projectId/api-keys", async (request, reply) => {
    createApiKeySchema.parse(request.body);
    return notImplemented(reply, "POST /v1/projects/:projectId/api-keys");
  });

  app.get("/v1/projects/:projectId/api-keys", async (_request, reply) => {
    return notImplemented(reply, "GET /v1/projects/:projectId/api-keys");
  });

  app.delete("/v1/projects/:projectId/api-keys/:keyId", async (_request, reply) => {
    return notImplemented(reply, "DELETE /v1/projects/:projectId/api-keys/:keyId");
  });
}
