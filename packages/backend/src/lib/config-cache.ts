import { getTenantConfig, type TenantConfig } from "./ddb.js";

interface Entry {
  config: TenantConfig;
  expiresAt: number;
}

const TTL_MS = 60_000;
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
