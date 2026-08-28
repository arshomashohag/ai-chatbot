import { createHash } from "node:crypto";

export function hashSiteKey(siteKey: string): string {
  return createHash("sha256").update(siteKey).digest("hex");
}
