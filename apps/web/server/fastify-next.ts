import type { FastifyInstance } from "fastify";
import type { NextApiRequest, NextApiResponse } from "next";

function getPathFromRequest(req: NextApiRequest) {
  const raw = req.query.path;
  const segments = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const searchIndex = req.url?.indexOf("?") ?? -1;
  const search = searchIndex >= 0 && req.url ? req.url.slice(searchIndex) : "";
  return `/${segments.join("/")}${search}`;
}

export async function forwardToFastify(
  req: NextApiRequest,
  res: NextApiResponse,
  app: FastifyInstance
) {
  await app.ready();

  const originalUrl = req.url;
  req.url = getPathFromRequest(req);

  try {
    await new Promise<void>((resolve, reject) => {
      res.on("finish", () => resolve());
      res.on("close", () => resolve());
      res.on("error", reject);
      app.server.emit("request", req, res);
    });
  } finally {
    req.url = originalUrl;
  }
}
