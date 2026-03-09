export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

export function optionalEnv(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export type SharedRuntimeConfig = {
  env: string;
  assetIdentifier: string;
  chainId: string;
};

export function loadSharedRuntimeConfig(): SharedRuntimeConfig {
  return {
    env: optionalEnv("MX402_ENV", "development"),
    assetIdentifier: requireEnv("MX402_ASSET_IDENTIFIER"),
    chainId: requireEnv("MX402_CHAIN_ID")
  };
}
