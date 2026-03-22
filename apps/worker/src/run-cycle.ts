import { createLogger } from "@mx402/observability";

import { confirmSubmittedProviderClaims } from "./claims.js";
import { syncTrackedDeposits } from "./deposits.js";
import { runSettlementCycle } from "./settlements.js";

export async function runWorkerCycle() {
  const logger = createLogger("worker");
  const depositResult = await syncTrackedDeposits(logger);
  const settlementResult = await runSettlementCycle(logger);
  const claimResult = await confirmSubmittedProviderClaims(logger);

  logger.info("Worker sync completed", {
    depositResult,
    settlementResult,
    claimResult
  });

  return {
    depositResult,
    settlementResult,
    claimResult
  };
}
