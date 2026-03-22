import type { FastifyInstance } from "fastify";
import type { NextApiRequest, NextApiResponse } from "next";

import { buildApp } from "../../../../api/dist/apps/api/src/app.js";
import { forwardToFastify } from "../../../server/fastify-next";

declare global {
  // eslint-disable-next-line no-var
  var __mx402VercelApiApp: FastifyInstance | undefined;
}

function getApp() {
  if (!global.__mx402VercelApiApp) {
    global.__mx402VercelApiApp = buildApp();
  }

  return global.__mx402VercelApiApp!;
}

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await forwardToFastify(req, res, getApp());
}
