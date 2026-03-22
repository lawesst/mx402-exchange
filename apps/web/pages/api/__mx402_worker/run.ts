import type { NextApiRequest, NextApiResponse } from "next";

import { runWorkerCycle } from "../../../../worker/dist/apps/worker/src/run-cycle.js";

function isAuthorized(request: NextApiRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const workerSecret = process.env.MX402_WORKER_RUN_SECRET || cronSecret;

  if (!workerSecret) {
    return false;
  }

  const authorization = request.headers.authorization;
  if (authorization === `Bearer ${workerSecret}`) {
    return true;
  }

  const headerSecret = request.headers["x-mx402-worker-secret"];
  return headerSecret === workerSecret;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Use GET or POST"
      }
    });
    return;
  }

  if (!isAuthorized(req)) {
    res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Missing or invalid worker run secret"
      }
    });
    return;
  }

  try {
    const result = await runWorkerCycle();
    res.status(200).json({
      ok: true,
      result
    });
  } catch (error) {
    res.status(500).json({
      error: {
        code: "WORKER_RUN_FAILED",
        message: error instanceof Error ? error.message : "Unexpected worker failure"
      }
    });
  }
}
