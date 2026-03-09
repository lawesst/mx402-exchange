import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    auth: {
      sessionId: string;
      userId: string;
      walletAddress: string;
      displayName: string | null;
      isAdmin: boolean;
    } | null;
  }
}
