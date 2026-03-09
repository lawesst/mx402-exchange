import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createSignerSession,
  deployLedgerContract,
  parseDeployedContractAddress,
  requireSettlementSecretKey,
  waitForTransactionFinality
} from "../apps/worker/src/chain.ts";

const ROOT_DIR = resolve(process.cwd());
const CONTRACT_META_MANIFEST = resolve(ROOT_DIR, "contracts/mx402-ledger/meta/Cargo.toml");
const CONTRACT_META_DIR = resolve(ROOT_DIR, "contracts/mx402-ledger/meta");
const DEFAULT_WASM_PATH = resolve(ROOT_DIR, "contracts/mx402-ledger/output/mx402-ledger.wasm");
const ENV_LOCAL_PATH = resolve(ROOT_DIR, ".env.local");

function ensureContractBuild() {
  execFileSync("cargo", ["run", "--manifest-path", CONTRACT_META_MANIFEST, "build"], {
    cwd: CONTRACT_META_DIR,
    stdio: "inherit"
  });
}

function upsertEnvValue(contents: string, key: string, value: string) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(contents) ? contents.replace(pattern, line) : `${contents.trimEnd()}\n${line}\n`;
}

function writeDeploymentToEnvLocal(input: {
  contractAddress: string;
  assetIdentifier: string;
  feeBps: number;
}) {
  const existing = existsSync(ENV_LOCAL_PATH) ? readFileSync(ENV_LOCAL_PATH, "utf8") : "";
  let updated = existing;
  updated = upsertEnvValue(updated, "MX402_LEDGER_CONTRACT", input.contractAddress);
  updated = upsertEnvValue(updated, "MX402_ASSET_IDENTIFIER", input.assetIdentifier);
  updated = upsertEnvValue(updated, "MX402_LEDGER_FEE_BPS", String(input.feeBps));
  writeFileSync(ENV_LOCAL_PATH, updated);
}

async function main() {
  const supportedTokenIdentifier = process.env.MX402_DEPLOY_ASSET_IDENTIFIER ?? process.env.MX402_ASSET_IDENTIFIER ?? "EGLD";
  const feeBps = Number(process.env.MX402_LEDGER_FEE_BPS ?? "250");
  const secretKey = requireSettlementSecretKey();
  const session = await createSignerSession(secretKey);
  const ownerAddress = session.account.address.toBech32();
  const operatorAddress = process.env.MX402_OPERATOR_ADDRESS ?? process.env.MX402_SETTLEMENT_ADDRESS ?? ownerAddress;
  const treasuryAddress = process.env.MX402_TREASURY_ADDRESS ?? ownerAddress;
  const wasmPath = resolve(process.env.MX402_LEDGER_WASM_PATH ?? DEFAULT_WASM_PATH);
  const shouldWriteEnv = !process.argv.includes("--no-write-env");

  ensureContractBuild();

  if (!existsSync(wasmPath)) {
    throw new Error(`Compiled wasm not found at ${wasmPath}`);
  }

  const deployResult = await deployLedgerContract(session, {
    wasmPath,
    supportedTokenIdentifier,
    feeBps,
    operatorAddress,
    treasuryAddress
  });

  const observed = await waitForTransactionFinality({
    txHash: deployResult.txHash,
    timeoutMs: Number(process.env.MX402_DEPLOY_TIMEOUT_MS ?? "180000"),
    pollIntervalMs: Number(process.env.MX402_DEPLOY_POLL_INTERVAL_MS ?? "6000")
  });

  if (observed.status.toLowerCase() !== "success" && observed.status.toLowerCase() !== "executed") {
    throw new Error(`Ledger deployment failed with status ${observed.status}`);
  }

  const deployedAddress = (await parseDeployedContractAddress({
    txHash: deployResult.txHash
  })) ?? deployResult.contractAddress;

  if (shouldWriteEnv) {
    writeDeploymentToEnvLocal({
      contractAddress: deployedAddress,
      assetIdentifier: supportedTokenIdentifier,
      feeBps
    });
  }

  console.log(JSON.stringify({
    txHash: deployResult.txHash,
    contractAddress: deployedAddress,
    operatorAddress,
    treasuryAddress,
    assetIdentifier: supportedTokenIdentifier,
    feeBps,
    wroteEnvLocal: shouldWriteEnv
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
