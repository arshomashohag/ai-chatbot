import { createHash, randomBytes } from "node:crypto";

export function hashSiteKey(siteKey: string): string {
  return createHash("sha256").update(siteKey).digest("hex");
}

export function generateSiteKey(): string {
  return `pk_live_${randomBytes(24).toString("hex")}`;
}

