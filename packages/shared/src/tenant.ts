// Defense-in-depth tenant-id guard. The DynamoDB IAM `LeadingKeys: TENANT#*`
// condition bounds handlers to tenant partitions but places NO boundary between
// tenants — isolation rests on `tenantId` always being derived server-side from
// verified claims. This guard is the app-layer backstop: it rejects any id shape
// that could broaden a key or query (partition-prefix injection via `#`, a `*`
// reaching an IAM/attribute wildcard, path/whitespace/control chars), so a bug
// that lets a malformed or attacker-influenced id through fails closed instead
// of silently crossing tenants. It is NOT a substitute for request-scoped IAM.

const MAX_TENANT_ID_LEN = 128;
// Reject '#' (partition-prefix escape), '*' (wildcard), '/', and any
// whitespace or control character. Allow the ids the platform actually mints
// (`t_<ulid>`) and Cognito-derived ids: letters, digits, `_`, `-`, `.`.
const VALID_TENANT_ID = /^[A-Za-z0-9_.-]+$/;

export function isValidTenantId(tenantId: unknown): tenantId is string {
  return (
    typeof tenantId === "string" &&
    tenantId.length > 0 &&
    tenantId.length <= MAX_TENANT_ID_LEN &&
    VALID_TENANT_ID.test(tenantId)
  );
}

/**
 * Assert `tenantId` is a well-formed tenant id and return it. Throws otherwise.
 * Call at the top of every tenant-scoped data-access function so a bad id never
 * reaches a DynamoDB key.
 */
export function assertTenantId(tenantId: unknown): string {
  if (!isValidTenantId(tenantId)) {
    throw new Error("invalid tenant id");
  }
  return tenantId;
}

// Session ids are also concatenated into composite DynamoDB keys
// (`TENANT#<t>#SESSION#<sid>`), so the same shapes that could escape the
// intended partition prefix (`#`, `*`, `/`, whitespace) must be rejected —
// especially on the admin transcript route where the id comes from a URL path
// segment. ULIDs (the minted format) are `[0-9A-Za-z]`, so the same charset
// allowlist applies.
export function isValidSessionId(sessionId: unknown): sessionId is string {
  return isValidTenantId(sessionId);
}

export function assertSessionId(sessionId: unknown): string {
  if (!isValidSessionId(sessionId)) {
    throw new Error("invalid session id");
  }
  return sessionId;
}
