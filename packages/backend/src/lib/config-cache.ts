import { getTenantConfig, type TenantConfig } from "./ddb.js";

interface Entry {
  config: TenantConfig;
  expiresAt: number;
}

// 10s (was 60s) so a suspend / auto-kill-switch is honored within ~10s on warm
// containers instead of up to a minute. Config items are tiny and cached, so
// the extra GetItems are cheap.
const TTL_MS = 10_000;
const cache = new Map<string, Entry>();

export async function cachedTenantConfig(
  tenantId: string
): Promise<TenantConfig | null> {
  const now = Date.now();
  const hit = cache.get(tenantId);
  if (hit && hit.expiresAt > now) return hit.config;
  const config = await getTenantConfig(tenantId);
  if (config) cache.set(tenantId, { config, expiresAt: now + TTL_MS });
  return config;
}

export function clearConfigCache(): void {
  cache.clear();
}

export function evictTenantConfig(tenantId: string): void {
  cache.delete(tenantId);
}
