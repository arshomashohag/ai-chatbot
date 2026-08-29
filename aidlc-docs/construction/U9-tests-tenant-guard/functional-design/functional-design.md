# U9 — Functional Design: Test backfill + tenant-access guard

**Unit**: U9 (final) · **Findings**: 2.1, 2.4, 3.27, 3.28, 3.29, 3.30, 3.31
**Requirements**: FR-4.6, FR-7.1, FR-7.2 · **Extensions**: SECURITY-08 (authz/IDOR), PBT-02/03/07/08 (blocking).

## Goal
Close the remaining test gaps and add the app-layer tenant-access backstop that the `LeadingKeys`-isn't-isolation finding (2.1) calls for.

## Design

### D1 — central tenant-access guard (2.1, FR-4.6)
The IAM `LeadingKeys: TENANT#*` bounds handlers to tenant partitions but places no boundary *between* tenants — isolation rests entirely on `tenantId` being derived server-side. Add a defense-in-depth runtime guard so a bug that lets a malformed/attacker-influenced `tenantId` through is caught, not silently permitted.

- New `packages/shared/src/tenant.ts`: `assertTenantId(tenantId: string): string`.
  - Rejects: empty/whitespace, values containing `#`, `*`, `/`, whitespace, or control chars, or exceeding a sane length. These are exactly the shapes that could broaden a key/query (e.g. a `*` reaching a `LeadingKeys` wildcard, or a `#`-injection escaping the intended partition prefix).
  - Returns the validated id (so call sites read `const t = assertTenantId(tenantId)`).
  - Pure, dependency-free (lives in shared) → property-testable.
- Apply it at the top of every tenant-scoped data-access function in `ddb.ts` and `admin-ddb.ts` (getTenantConfig, putSession, searchProducts, queryHistory, persistMessages, incrementUsage, getUsage, tripKillSwitch, listKb, addKb, deleteKb, issueSiteKey, listSessions, getTranscript, ensureTenantConfig — which guards both `ensureUserTenant` call paths). One line each; throws before any DDB call on a bad id.
- **`sessionId` is the other half of the composite key** (`TENANT#<t>#SESSION#<sid>`) and, on the admin transcript route, comes from a raw URL path segment. Add `assertSessionId` (same charset allowlist — ULIDs are `[0-9A-Za-z]`) and apply it wherever `sessionId` builds a key: `getTranscript`, `queryHistory`, `persistMessages`, `putSession`. (Added after review flagged the gap.)
- This does NOT replace app-layer derivation — it hardens it. Documented as defense-in-depth, not a substitute for request-scoped IAM (still the long-term fix, out of scope).

### D2 — chat-handler test suite (2.4, FR-7.1)
The money-path handler had no unit tests (U2–U4 added focused origin/quota/robustness tests; U9 completes coverage). Add `handlers/chat.test.ts` (or extend the existing chat.*.test.ts set) covering, end to end through the handler with mocked collaborators:
- 401 on bad/expired token (JwtError) and on origin mismatch (covered in chat.origin — consolidate/confirm).
- 503 on suspended / killSwitch.
- 429 on rate-limit trip.
- 200 friendly-degrade when the adapter throws.
- 200 happy path with assertions that persistMessages + incrementUsage were called with the right tenant/session.
Most branches are already covered by chat.origin/quota/robustness tests; U9 fills the remaining gaps (killSwitch 503, adapter-throws degrade, happy-path persistence assertion) and documents the coverage map.

### D3 — JWT tests (3.27, FR-7.2)
Extend `jwt-verify.test.ts` (already strong after U2) — confirm coverage of: algorithm confusion (alg≠ES256 rejected — done), cross-key rejection (done in U2), kid/iss/aud enforcement (done in U2). Add the DER→JOSE PBT (done in U2) — verify it exercises r/s of varying byte lengths incl. 0x00-prefixed (high-bit) padding. If the existing fuzz over random session_id doesn't reliably produce 0x00-padded r/s, add a targeted case. **Mostly satisfied by U2; U9 audits + fills.**

### D4 — rate-limiter tests + PBT (3.28, FR-7.2)
Extend `rate-limit.test.ts` (U4 added TTL + fail-open). Add:
- **Cap-boundary PBT** (PBT-03 invariant): the conditional expression `attribute_not_exists(#c) OR #c < :max` — model the counter and assert that a wrong operator (`<=`) would be caught. Simulate the Nth allowed / (N+1)th throttled via the mock's conditional behavior over a generated max.
- **Window-key PBT** (PBT-03): for generated `nowMs`, the SK window index and TTL are monotonic and TTL is always `> nowSec`.
- Domain generators for `nowMs`/`max` (PBT-07); seed logging (PBT-08).

### D5 — site-key / grace-key rotation tests (3.29, FR-7.2)
New `lib/rotation.test.ts` (or extend admin-ddb.test): `issueSiteKey` + `findTenantBySiteKeyHash`:
- After rotation, the **new** key resolves to the tenant (CONFIG updated).
- The **old** key still resolves during grace (GRACEKEY# pointer written, resolves via the second CONFIG lookup).
- `oldHash === newHash` skips the grace write (no-op rotation).
- The grace pointer carries a `ttl`.
- A grace-key belonging to tenant A resolves tenant A (isolation on the rotation path).

### D6 — post-confirmation idempotency (3.30)
Already covered by `admin-ddb.test.ts` (U1) — audit that it includes: same sub twice → one tenant; partial-failure (config missing) re-creates config; race (profile put loses) resolves the winner. Confirm; add any missing case.

### D7 — CDK template assertions (3.31, FR-7.2)
New `infra/lib/api-security.test.ts`: synthesize the Api + Edge stacks and assert security-relevant template properties:
- The admin routes (`/v1/admin/*`) have a **JWT authorizer** attached; `/health` and `/v1/widget/*` do **not**.
- The WAF (Edge, from U7's edge-csp.test — extend) has the rate-limit rule.
- The KMS key spec is `ECC_NIST_P256` / SIGN_VERIFY.
- (CSP assertions already in edge-csp.test from U7.)

## Testable Properties (PBT-01)
| Component | Property | Category | Blocking |
|---|---|---|---|
| `assertTenantId` | accepts valid ids; rejects any id with `# * / whitespace/control`; idempotent on valid | Invariant | PBT-03 ✅ |
| rate-limiter window/TTL | TTL > nowSec, window monotonic in nowMs | Invariant | PBT-03 ✅ |
| DER→JOSE (audit) | round-trips (U2) | Round-trip | PBT-02 ✅ |

## Security compliance
- **SECURITY-08** (authz / IDOR): tenant-access guard + full negative cross-tenant assertions across every handler path. ✅
- **PBT-02/03/07/08**: DER→JOSE round-trip, tenant-id + rate-limiter invariants, domain generators, seed logging. ✅ blocking.

## Definition of Done
- `assertTenantId` exists, is applied to every tenant-scoped DDB function, and has PBT + example tests.
- Chat-handler coverage map complete (401/503/429/degrade/happy-path).
- Rate-limiter cap-boundary + window PBT added.
- Rotation lifecycle tested (new/old/grace/no-op/isolation).
- CDK template assertions for authorizer coverage + KMS spec + WAF.
- Post-confirmation idempotency confirmed.
- Full suite green (incl. all PBT with seeds); both E2E green; typecheck + lint + synth clean.
