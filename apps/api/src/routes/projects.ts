import type { FastifyInstance } from "fastify";

import { getPrismaClient } from "@mx402/db";
import { createApiKeySchema, createGrantSchema, createProjectSchema } from "@mx402/domain";

import { requireSession } from "../auth.js";
import { generateProjectApiKey } from "../keys.js";

export async function registerProjectRoutes(app: FastifyInstance) {
  app.post("/v1/projects", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const input = createProjectSchema.parse(request.body);
    const prisma = getPrismaClient();
    const project = await prisma.buyerProject.create({
      data: {
        user_id: auth.userId,
        name: input.name
      }
    });

    return reply.code(201).send({
      id: project.id,
      name: project.name,
      status: project.status,
      createdAt: project.created_at.toISOString()
    });
  });

  app.get("/v1/projects", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const prisma = getPrismaClient();
    const projects = await prisma.buyerProject.findMany({
      where: {
        user_id: auth.userId
      },
      include: {
        _count: {
          select: {
            apiKeys: true,
            grants: true
          }
        }
      },
      orderBy: {
        created_at: "desc"
      }
    });

    return reply.code(200).send({
      data: projects.map((project) => ({
        id: project.id,
        name: project.name,
        status: project.status,
        apiKeyCount: project._count.apiKeys,
        grantCount: project._count.grants,
        createdAt: project.created_at.toISOString(),
        updatedAt: project.updated_at.toISOString()
      }))
    });
  });

  app.get("/v1/projects/:projectId", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const { projectId } = request.params as { projectId: string };
    const prisma = getPrismaClient();
    const project = await prisma.buyerProject.findFirst({
      where: {
        id: projectId,
        user_id: auth.userId
      },
      include: {
        grants: {
          where: {
            status: "active",
            revoked_at: null
          },
          include: {
            product: {
              include: {
                provider: true
              }
            }
          }
        }
      }
    });

    if (!project) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Project not found"
        }
      });
    }

    return reply.code(200).send({
      id: project.id,
      name: project.name,
      status: project.status,
      grants: project.grants.map((grant) => ({
        productId: grant.product_id,
        productSlug: grant.product.slug,
        productName: grant.product.name,
        providerName: grant.product.provider.display_name,
        grantedAt: grant.created_at.toISOString()
      })),
      createdAt: project.created_at.toISOString(),
      updatedAt: project.updated_at.toISOString()
    });
  });

  app.post("/v1/projects/:projectId/grants", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const { projectId } = request.params as { projectId: string };
    const input = createGrantSchema.parse(request.body);
    const prisma = getPrismaClient();
    const project = await prisma.buyerProject.findFirst({
      where: {
        id: projectId,
        user_id: auth.userId,
        status: "active"
      }
    });

    if (!project) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Project not found"
        }
      });
    }

    const product = await prisma.providerProduct.findFirst({
      where: {
        id: input.productId,
        status: "active",
        provider: {
          status: "approved"
        }
      }
    });

    if (!product) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Active product not found"
        }
      });
    }

    const grant = await prisma.projectProductGrant.upsert({
      where: {
        project_id_product_id: {
          project_id: project.id,
          product_id: product.id
        }
      },
      update: {
        status: "active",
        revoked_at: null
      },
      create: {
        project_id: project.id,
        product_id: product.id,
        status: "active"
      }
    });

    return reply.code(201).send({
      id: grant.id,
      projectId: grant.project_id,
      productId: grant.product_id,
      status: grant.status,
      createdAt: grant.created_at.toISOString()
    });
  });

  app.delete("/v1/projects/:projectId/grants/:productId", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const { projectId, productId } = request.params as { projectId: string; productId: string };
    const prisma = getPrismaClient();
    const project = await prisma.buyerProject.findFirst({
      where: {
        id: projectId,
        user_id: auth.userId
      }
    });

    if (!project) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Project not found"
        }
      });
    }

    await prisma.projectProductGrant.updateMany({
      where: {
        project_id: projectId,
        product_id: productId,
        status: "active",
        revoked_at: null
      },
      data: {
        status: "revoked",
        revoked_at: new Date()
      }
    });

    return reply.code(204).send();
  });

  app.post("/v1/projects/:projectId/api-keys", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const { projectId } = request.params as { projectId: string };
    const input = createApiKeySchema.parse(request.body);
    const prisma = getPrismaClient();
    const project = await prisma.buyerProject.findFirst({
      where: {
        id: projectId,
        user_id: auth.userId,
        status: "active"
      }
    });

    if (!project) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Project not found"
        }
      });
    }

    const key = generateProjectApiKey();
    const apiKey = await prisma.projectApiKey.create({
      data: {
        project_id: project.id,
        name: input.name,
        key_prefix: key.prefix,
        secret_hash: key.secretHash
      }
    });

    return reply.code(201).send({
      id: apiKey.id,
      name: apiKey.name,
      prefix: apiKey.key_prefix,
      apiKey: key.plainText,
      createdAt: apiKey.created_at.toISOString()
    });
  });

  app.get("/v1/projects/:projectId/api-keys", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const { projectId } = request.params as { projectId: string };
    const prisma = getPrismaClient();
    const project = await prisma.buyerProject.findFirst({
      where: {
        id: projectId,
        user_id: auth.userId
      }
    });

    if (!project) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Project not found"
        }
      });
    }

    const keys = await prisma.projectApiKey.findMany({
      where: {
        project_id: projectId
      },
      orderBy: {
        created_at: "desc"
      }
    });

    return reply.code(200).send({
      data: keys.map((key) => ({
        id: key.id,
        name: key.name,
        prefix: key.key_prefix,
        status: key.status,
        lastUsedAt: key.last_used_at?.toISOString() ?? null,
        revokedAt: key.revoked_at?.toISOString() ?? null,
        createdAt: key.created_at.toISOString()
      }))
    });
  });

  app.delete("/v1/projects/:projectId/api-keys/:keyId", async (request, reply) => {
    const auth = await requireSession(request, reply);
    if (!auth) {
      return reply;
    }

    const { projectId, keyId } = request.params as { projectId: string; keyId: string };
    const prisma = getPrismaClient();
    const project = await prisma.buyerProject.findFirst({
      where: {
        id: projectId,
        user_id: auth.userId
      }
    });

    if (!project) {
      return reply.code(404).send({
        error: {
          code: "NOT_FOUND",
          message: "Project not found"
        }
      });
    }

    await prisma.projectApiKey.updateMany({
      where: {
        id: keyId,
        project_id: projectId,
        status: "active"
      },
      data: {
        status: "revoked",
        revoked_at: new Date()
      }
    });

    return reply.code(204).send();
  });
}
