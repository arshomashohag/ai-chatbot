import { createHash, randomBytes } from "node:crypto";

export function hashSiteKey(siteKey: string): string {
  return createHash("sha256").update(siteKey).digest("hex");
}

export function generateSiteKey(): string {
  return `pk_live_${randomBytes(24).toString("hex")}`;
}

// Stable sha256 hex of arbitrary page text — used to detect whether a page's
// content has changed since we last showed it to the model.
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// Short sha256 hex of a page URL — the SITECONTENT# sort-key suffix, so each
// distinct page of a tenant's site gets its own snapshot record.
export function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 32);
}

