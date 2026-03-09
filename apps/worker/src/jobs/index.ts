export const jobNames = [
  "sync-chain-events",
  "create-settlement-batch",
  "submit-settlement-batch",
  "confirm-settlement-batch",
  "confirm-provider-claim",
  "reconcile-ledger"
] as const;

export type JobName = (typeof jobNames)[number];
