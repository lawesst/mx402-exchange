import type { FastifyReply } from "fastify";

export function notImplemented(reply: FastifyReply, route: string) {
  return reply.code(501).send({
    error: {
      code: "NOT_IMPLEMENTED",
      message: `${route} is scaffolded but not implemented yet`
    }
  });
}
