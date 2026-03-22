import type { FastifyInstance } from "fastify";
import type { NextApiRequest, NextApiResponse } from "next";

import { buildGatewayApp } from "../../../../gateway/dist/apps/gateway/src/app.js";
import { forwardToFastify } from "../../../server/fastify-next";

declare global {
  // eslint-disable-next-line no-var
  var __mx402VercelGatewayApp: FastifyInstance | undefined;
}

function getApp() {
  if (!global.__mx402VercelGatewayApp) {
    global.__mx402VercelGatewayApp = buildGatewayApp();
  }

  return global.__mx402VercelGatewayApp!;
}

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await forwardToFastify(req, res, getApp());
}
