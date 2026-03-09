import { Prisma, PrismaClient } from "@prisma/client";

declare global {
  var __mx402Prisma: PrismaClient | undefined;
}

export function getPrismaClient(): PrismaClient {
  if (!globalThis.__mx402Prisma) {
    globalThis.__mx402Prisma = new PrismaClient();
  }

  return globalThis.__mx402Prisma;
}

export { Prisma };
