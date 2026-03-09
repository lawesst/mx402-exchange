import { buildChainReadHeaders, loadChainReadRuntimeConfig } from "../packages/config/src/index.ts";

type ListedTransaction = {
  txHash: string;
};

async function main() {
  const config = loadChainReadRuntimeConfig();
  const txHash = process.argv[2];

  if (!config.apiUrl) {
    throw new Error("Missing chain API configuration");
  }

  const lookupHash = txHash ?? await getLatestSuccessfulTxHash(config.apiUrl);
  const candidates = [
    `${config.gatewayUrl}/transaction/${lookupHash}?withResults=true`,
    `${config.gatewayUrl}/transactions/${lookupHash}?withResults=true`,
    `${config.apiUrl}/transactions/${lookupHash}?withResults=true`,
    `${config.apiUrl}/transaction/${lookupHash}?withResults=true`
  ];

  for (const candidate of candidates) {
    const response = await fetch(candidate, {
      headers: buildChainReadHeaders()
    });

    if (!response.ok) {
      console.log(`MISS ${response.status} ${candidate}`);
      continue;
    }

    const payload = await response.json();
    console.log(JSON.stringify({
      ok: true,
      endpoint: candidate,
      txHash: lookupHash,
      status: payload.status ?? payload.transaction?.status ?? payload.data?.transaction?.status ?? null,
      sender: payload.sender ?? payload.transaction?.sender ?? payload.data?.transaction?.sender ?? null,
      receiver: payload.receiver ?? payload.transaction?.receiver ?? payload.data?.transaction?.receiver ?? null
    }, null, 2));
    return;
  }

  throw new Error(`Unable to fetch transaction ${lookupHash} from configured chain endpoints`);
}

async function getLatestSuccessfulTxHash(apiUrl: string): Promise<string> {
  const response = await fetch(`${apiUrl}/transactions?size=1&status=success&order=desc`, {
    headers: buildChainReadHeaders()
  });

  if (!response.ok) {
    throw new Error(`Failed to list latest devnet transaction: ${response.status}`);
  }

  const payload = await response.json() as ListedTransaction[];
  const transaction = payload[0];

  if (!transaction?.txHash) {
    throw new Error("No successful devnet transaction returned by chain API");
  }

  return transaction.txHash;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
