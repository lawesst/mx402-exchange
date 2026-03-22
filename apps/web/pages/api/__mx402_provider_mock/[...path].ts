import type { NextApiRequest, NextApiResponse } from "next";

function send(res: NextApiResponse, status: number, payload: unknown) {
  res.status(status).json(payload);
}

function getPathSegments(req: NextApiRequest) {
  const raw = req.query.path;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

async function readJsonBody(req: NextApiRequest) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolve());
    req.on("error", reject);
  });

  if (chunks.length === 0) {
    return null;
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const segments = getPathSegments(req);

  if (req.method === "GET" && segments.length === 1 && segments[0] === "health") {
    return send(res, 200, {
      ok: true,
      service: "mx402-vercel-provider-mock"
    });
  }

  if (segments[0] !== "providers" || segments.length < 2) {
    return send(res, 404, {
      error: "not found"
    });
  }

  const providerSlug = segments[1];
  const route = segments.slice(2);

  if (req.method === "GET" && route[0] === "explorer" && route[1] === "v1" && route[2] === "transactions" && route[3]) {
    return send(res, 200, {
      provider: providerSlug,
      txHash: decodeURIComponent(route[3]),
      status: "success",
      shard: 1,
      source: "mx402-vercel-provider-mock"
    });
  }

  if (req.method === "GET" && route[0] === "events" && route[1] === "v1" && route[2] === "stream" && route[3]) {
    return send(res, 200, {
      provider: providerSlug,
      topic: decodeURIComponent(route[3]),
      eventCount: 3,
      latestBlock: 18203491,
      source: "mx402-vercel-provider-mock"
    });
  }

  if (req.method === "GET" && route[0] === "defi" && route[1] === "v1" && route[2] === "quote" && route[3]) {
    return send(res, 200, {
      provider: providerSlug,
      pair: decodeURIComponent(route[3]),
      price: 31.24,
      spreadBps: 7,
      liquidityUsd: 1843221,
      source: "mx402-vercel-provider-mock"
    });
  }

  if (req.method === "GET" && route[0] === "risk" && route[1] === "v1" && route[2] === "wallet" && route[3]) {
    return send(res, 200, {
      provider: providerSlug,
      address: decodeURIComponent(route[3]),
      score: 21,
      riskLevel: "low",
      source: "mx402-vercel-provider-mock"
    });
  }

  if (req.method === "GET" && route[0] === "nft" && route[1] === "v1" && route[2] === "collections" && route[3] && route[4] === "items") {
    return send(res, 200, {
      provider: providerSlug,
      collection: decodeURIComponent(route[3]),
      items: [
        {
          tokenId: "NFT-001",
          rarityScore: 82.1,
          floorEgld: 0.72
        },
        {
          tokenId: "NFT-002",
          rarityScore: 77.4,
          floorEgld: 0.58
        }
      ],
      source: "mx402-vercel-provider-mock"
    });
  }

  if (req.method === "GET" && route[0] === "staking" && route[1] === "v1" && route[2] === "providers" && route[3] && route[4] === "rewards") {
    return send(res, 200, {
      provider: providerSlug,
      validatorId: decodeURIComponent(route[3]),
      apr: 7.9,
      estimatedEpochRewardEgld: 0.043,
      source: "mx402-vercel-provider-mock"
    });
  }

  if (req.method === "POST" && route[0] === "identity" && route[1] === "v1" && route[2] === "verify") {
    const payload = await readJsonBody(req);

    return send(res, 200, {
      provider: providerSlug,
      verified: true,
      score: 0.93,
      input: payload,
      source: "mx402-vercel-provider-mock"
    });
  }

  return send(res, 404, {
    error: "not found"
  });
}
