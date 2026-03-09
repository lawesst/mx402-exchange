import { createHash, randomBytes } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function generateProjectApiKey(): {
  plainText: string;
  prefix: string;
  secretHash: string;
} {
  const secret = randomBytes(24).toString("hex");
  const prefix = `mx402_${secret.slice(0, 10)}`;
  const plainText = `${prefix}.${secret}`;

  return {
    plainText,
    prefix,
    secretHash: sha256(plainText)
  };
}
