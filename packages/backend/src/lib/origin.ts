export function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return null;
  }
}

export function matchAllowedOrigin(
  origin: string,
  allowlist: string[]
): string | null {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return null;
  const match = allowlist.find((a) => normalizeOrigin(a) === normalized);
  return match ? normalizeOrigin(match) : null;
}

export function isOriginAllowed(
  origin: string,
  allowlist: string[]
): boolean {
  return matchAllowedOrigin(origin, allowlist) !== null;
}
