import { createServer, type ServerResponse } from "node:http";

const port = Number(process.env.MX402_PROVIDER_MOCK_PORT ?? "4580");

function respondJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

  if (request.method === "GET" && url.pathname === "/health") {
    return respondJson(response, 200, {
      ok: true,
      service: "mx402-provider-mock"
    });
  }

  if (request.method === "GET" && url.pathname.startsWith("/risk/")) {
    const address = decodeURIComponent(url.pathname.replace("/risk/", ""));

    return respondJson(response, 200, {
      address,
      score: 21,
      riskLevel: "low",
      source: "mx402-devnet-provider-mock"
    });
  }

  if (request.method === "GET" && url.pathname.startsWith("/activity/")) {
    const address = decodeURIComponent(url.pathname.replace("/activity/", ""));

    return respondJson(response, 200, {
      address,
      activeDays30d: 9,
      contractInteractions30d: 14,
      tokenTransfers30d: 27,
      source: "mx402-devnet-provider-mock"
    });
  }

  if (request.method === "GET" && url.pathname.startsWith("/labels/")) {
    const address = decodeURIComponent(url.pathname.replace("/labels/", ""));

    return respondJson(response, 200, {
      address,
      labels: ["defi-user", "nft-holder"],
      confidence: 0.91,
      source: "mx402-devnet-provider-mock"
    });
  }

  if (request.method === "GET" && url.pathname.startsWith("/portfolio/")) {
    const address = decodeURIComponent(url.pathname.replace("/portfolio/", ""));

    return respondJson(response, 200, {
      address,
      uniqueTokens: 6,
      nftCollections: 2,
      estimatedUsdValue: 143.27,
      source: "mx402-devnet-provider-mock"
    });
  }

  return respondJson(response, 404, {
    error: "not found"
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`MX402 provider mock listening on http://127.0.0.1:${port}`);
});
