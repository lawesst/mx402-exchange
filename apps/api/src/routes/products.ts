import type { FastifyInstance } from "fastify";

import { getPrismaClient } from "@mx402/db";

export async function registerProductRoutes(app: FastifyInstance) {
  app.get("/v1/products", async () => {
    const prisma = getPrismaClient();
    const products = await prisma.providerProduct.findMany({
      where: {
        status: "active",
        provider: {
          status: "approved"
        }
      },
      include: {
        provider: true
      },
      orderBy: {
        created_at: "desc"
      },
      take: 50
    });

    return {
      data: products.map((product) => ({
        id: product.id,
        slug: product.slug,
        name: product.name,
        shortDescription: product.short_description,
        description: product.description,
        priceAtomic: product.price_atomic.toString(),
        assetIdentifier: null,
        baseUrl: product.base_url,
        upstreamMethod: product.upstream_method,
        provider: {
          id: product.provider.id,
          slug: product.provider.slug,
          displayName: product.provider.display_name
        },
        status: product.status,
        createdAt: product.created_at.toISOString(),
        updatedAt: product.updated_at.toISOString()
      })),
      nextCursor: null
    };
  });

  app.get("/v1/products/:productId", async (request, reply) => {
    const { productId } = request.params as { productId: string };
    const prisma = getPrismaClient();
    const product = await prisma.providerProduct.findFirst({
      where: {
        id: productId,
        status: "active",
        provider: {
          status: "approved"
        }
      },
      include: {
        provider: true
      }
    });

    if (!product) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Product not found"
        }
      });
    }

    return reply.code(200).send({
      id: product.id,
      slug: product.slug,
      name: product.name,
      shortDescription: product.short_description,
      description: product.description,
      priceAtomic: product.price_atomic.toString(),
      baseUrl: product.base_url,
      upstreamPathTemplate: product.upstream_path_template,
      upstreamMethod: product.upstream_method,
      timeoutMs: product.timeout_ms,
      rateLimitPerMinute: product.rate_limit_per_minute,
      provider: {
        id: product.provider.id,
        slug: product.provider.slug,
        displayName: product.provider.display_name
      }
    });
  });
}
