import type { FastifyInstance } from "fastify";

import { gatewayCallSchema } from "@mx402/domain";

export async function registerGatewayRoutes(app: FastifyInstance) {
  app.post("/v1/gateway/products/:productId/call", async (request, reply) => {
    gatewayCallSchema.parse(request.body);

    return reply.code(501).send({
      error: {
        code: "NOT_IMPLEMENTED",
        message: "Gateway billing and forwarding flow is scaffolded but not implemented yet"
      }
    });
  });
}
