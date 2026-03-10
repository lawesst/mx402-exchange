import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const PROVIDER_SECRET_ENVELOPE_PREFIX = "enc:v1:";

function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

function applyEnvFile(path: string) {
  if (!existsSync(path)) {
    return;
  }

  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile(path);
    return;
  }

  const parsed = parseEnvFile(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function bootstrapLocalEnv() {
  let currentDir = process.cwd();
  const visited = new Set<string>();

  while (!visited.has(currentDir)) {
    visited.add(currentDir);

    applyEnvFile(join(currentDir, ".env"));
    applyEnvFile(join(currentDir, ".env.local"));

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }
}

bootstrapLocalEnv();

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

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export type SharedRuntimeConfig = {
  env: string;
  assetIdentifier: string;
  chainId: string;
};

export type ChainReadRuntimeConfig = {
  apiUrl: string;
  gatewayUrl: string;
  apiKey: string;
  eventsUrl: string;
};

export function loadSharedRuntimeConfig(): SharedRuntimeConfig {
  return {
    env: optionalEnv("MX402_ENV", "development"),
    assetIdentifier: requireEnv("MX402_ASSET_IDENTIFIER"),
    chainId: requireEnv("MX402_CHAIN_ID")
  };
}

export function loadChainReadRuntimeConfig(): ChainReadRuntimeConfig {
  return {
    apiUrl: normalizeUrl(optionalEnv("MULTIVERSX_CHAIN_API_URL", optionalEnv("MULTIVERSX_API_URL", "https://api.multiversx.com"))),
    gatewayUrl: normalizeUrl(optionalEnv("MULTIVERSX_CHAIN_GATEWAY_URL", optionalEnv("MULTIVERSX_GATEWAY_URL", "https://gateway.multiversx.com"))),
    apiKey: optionalEnv("MULTIVERSX_CHAIN_API_KEY", ""),
    eventsUrl: optionalEnv("MULTIVERSX_CHAIN_EVENTS_URL", "")
  };
}

export function buildChainReadHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  const { apiKey } = loadChainReadRuntimeConfig();

  return {
    accept: "application/json",
    ...(apiKey ? { "Api-Key": apiKey } : {}),
    ...(extraHeaders ?? {})
  };
}

function deriveProviderSecretEncryptionKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

function requireProviderSecretEncryptionKey(): Buffer {
  const secret = process.env.MX402_PROVIDER_SECRET_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("Missing required env var: MX402_PROVIDER_SECRET_ENCRYPTION_KEY");
  }

  return deriveProviderSecretEncryptionKey(secret);
}

export function isEncryptedProviderSecret(value: string): boolean {
  return value.startsWith(PROVIDER_SECRET_ENVELOPE_PREFIX);
}

export function encryptProviderSecret(plaintext: string): string {
  const key = requireProviderSecretEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${PROVIDER_SECRET_ENVELOPE_PREFIX}${iv.toString("base64url")}.${authTag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptProviderSecret(ciphertextEnvelope: string): string {
  if (!isEncryptedProviderSecret(ciphertextEnvelope)) {
    return ciphertextEnvelope;
  }

  const payload = ciphertextEnvelope.slice(PROVIDER_SECRET_ENVELOPE_PREFIX.length);
  const [ivBase64Url, authTagBase64Url, ciphertextBase64Url] = payload.split(".");
  if (!ivBase64Url || !authTagBase64Url || !ciphertextBase64Url) {
    throw new Error("Invalid provider secret envelope");
  }

  const key = requireProviderSecretEncryptionKey();
  const iv = Buffer.from(ivBase64Url, "base64url");
  const authTag = Buffer.from(authTagBase64Url, "base64url");
  const ciphertext = Buffer.from(ciphertextBase64Url, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
