import { optionalEnv } from "@mx402/config";
import { createLogger } from "@mx402/observability";

import { confirmSubmittedProviderClaims } from "./claims.js";
import { syncTrackedDeposits } from "./deposits.js";
import { jobNames } from "./jobs/index.js";
import { runSettlementCycle } from "./settlements.js";

const logger = createLogger("worker");

async function main() {
  const runOnce = process.argv.includes("--once") || optionalEnv("WORKER_RUN_ONCE", "false") === "true";
  const pollIntervalMs = Number(optionalEnv("WORKER_POLL_INTERVAL_MS", "30000"));
  let inFlight = false;

  const runSync = async () => {
    if (inFlight) {
      logger.warn("Skipping deposit sync because a previous run is still active");
      return;
    }

    inFlight = true;
    try {
      const depositResult = await syncTrackedDeposits(logger);
      const settlementResult = await runSettlementCycle(logger);
      const claimResult = await confirmSubmittedProviderClaims(logger);
      logger.info("Worker sync completed", {
        depositResult,
        settlementResult,
        claimResult
      });
    } finally {
      inFlight = false;
    }
  };

  logger.info("MX402 worker started", {
    jobs: jobNames,
    runOnce,
    pollIntervalMs
  });

  await runSync();

  if (runOnce) {
    return;
  }

  setInterval(() => {
    runSync().catch((error) => {
      logger.error("Scheduled deposit sync failed", {
        message: error instanceof Error ? error.message : "Unexpected error"
      });
    });
  }, pollIntervalMs);
}

main().catch((error) => {
  logger.error("Worker crashed", {
    message: error instanceof Error ? error.message : "Unexpected error"
  });
  process.exit(1);
});
