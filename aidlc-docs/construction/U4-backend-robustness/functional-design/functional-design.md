# U4 — Functional Design: Backend robustness

**Unit**: U4 · **Findings**: 2.6, 2.7, 3.8, 3.9, 3.13
**Requirements**: FR-4.5, FR-1.3, FR-4 · **Extensions**: SECURITY-15 (fail-closed, error handling, resource cleanup), SECURITY-08 (CORS), RESILIENCY-10 (timeouts, graceful degradation).

## Problems (verified)
- **2.6 — CORS on errors / whole chat path**: `http.ts error()` sets no CORS headers; the chat handler emits **no CORS headers on any response**. The widget calls `/v1/chat/message` cross-origin, so the browser can't read error bodies (or even success without CORS). Session handler sets CORS only on the 200.
- **2.7 — rate-limit/usage 500 the user**: `allow()` re-throws non-`ConditionalCheckFailedException` errors; in `chat.ts` the two `allow()` calls sit in `Promise.all` with no try/catch → a DDB blip becomes an unhandled 500. `persistMessages`/`incrementUsage` are awaited after the reply is generated and unguarded → a storage/usage blip discards an already-generated (already-paid-for) reply as a 500.
- **3.8 — kill-switch latency**: `config-cache.ts` 60s TTL means a suspend/kill takes up to 60s to honor on warm containers.
- **3.9 — unguarded JSON.parse**: `chat.ts` and `admin.ts` call `JSON.parse(event.body)` without try/catch → a malformed body throws → 500 instead of a clean 400.
- **3.13 — rate-limiter TTL landmine**: `ttl = (window + 2) * windowSec` treats a window-index as epoch seconds; correct only by algebraic coincidence.

## Design

### D1 — CORS on the chat path (2.6)
- The chat request is cross-origin from the merchant page. We already validate the request Origin against `claims.origin` (U2). Build `corsHeaders(origin)` (reuse the session handler's shape) and attach it to **every** chat response — 401/400/429/503/200/degrade/over-quota.
- **Which origin to reflect?** For responses produced *after* the origin check passes, reflect `claims.origin` (validated). For the 401 emitted *before/at* the origin check (bad token, origin mismatch), reflect the request Origin only if it is a well-formed origin (normalized), else omit — never echo an arbitrary raw Origin. This keeps the safe "reflect only validated" property while letting the browser read the error.
  - Simplest correct approach: compute `reflectOrigin = normalizeOrigin(requestOrigin)` once; on the pre-auth errors, attach CORS with `reflectOrigin` if non-null. Since normalize only accepts scheme+host, this cannot echo a header-injection payload.
- Add a factory `widgetCors(origin: string | null)` in a small shared spot (or inline in chat handler) returning the header map (empty if origin null).
- **Preflight**: add OPTIONS handling. The route already lists `OPTIONS` (`api-stack.ts`). Return 204 + CORS for an OPTIONS request early in the handler.

### D2 — decouple rate-limit + usage/persist from the served reply (2.7)
- **Rate limit fail policy — explicit fail-OPEN on infra error**: wrap the `allow()` calls so a non-conditional DDB error (throttle/timeout) is caught and treated as "allow" (fail-open), because the rate limiter is an abuse *dampener*, not a security boundary — its unavailability must not deny service. (The hard spend boundary is the U3 quota, which fails *closed*.) A `ConditionalCheckFailedException` still correctly returns 429. Log the fail-open event.
  - Rationale documented: fail-open here is safe because quota (U3) independently bounds spend; failing closed on the rate limiter would turn a DDB blip into an outage.
- **Usage/persist off the served-reply path**: wrap `persistMessages` and `incrementUsage` in try/catch that logs on failure but still returns the generated reply. A storage/usage blip must not turn a successful, already-paid-for model reply into a 500. (Usage under-count on failure is acceptable; the reply is the user-visible product.)

### D3 — kill-switch fast path (3.8)
- Keep the 60s config cache for performance, but check the **kill/suspend state** with a shorter freshness guarantee. Minimal, low-risk approach: reduce the config-cache TTL for the *kill-relevant* fields by re-reading config when the cached entry is older than a short kill-TTL (e.g. 5s) — OR simpler: lower the whole config cache TTL from 60s to a smaller value (e.g. 10s). Decision: **lower TTL to 10s.** This bounds kill-switch latency to ≤10s per warm container (was 60s) at the cost of ~6× more config GetItems — acceptable given config items are tiny and cached. (A dedicated denylist fast-path is a larger change deferred; 10s meets the "honored quickly" bar and shrinks the U3 cross-container overshoot too.)
- Document that U3's auto-kill now propagates within ≤10s across warm containers (down from 60s).

### D4 — guard JSON.parse (3.9)
- Add a `parseJsonBody(event.body)` helper (or inline try/catch) in `chat.ts` and `admin.ts` returning a clean 400 (`invalid_request`) on malformed JSON, matching the session handler's existing guard.

### D5 — rate-limiter TTL correctness (3.13)
- Change `ttl` to an explicit epoch-seconds value: `Math.floor(nowMs / 1000) + limit.windowSec * 2`. Behaviorally ~identical today but no longer relies on the window-index≈epoch coincidence; robust to any `windowSec`. Existing window-keying tests unaffected (they assert the SK window index, not the TTL).

## Interfaces changed
| Symbol | Change |
|---|---|
| chat handler | CORS on all responses; OPTIONS preflight; fail-open rate limit; guarded persist/usage; guarded JSON.parse |
| admin handler | guarded JSON.parse → 400 |
| `config-cache` TTL | 60s → 10s |
| `allow` (rate-limit) | TTL computed as explicit epoch seconds |
| `widgetCors(origin)` | new small helper (or reuse session's) |

## Testable Properties (PBT-01)
Discrete branches (CORS presence, 400 on bad JSON, fail-open) → example-based. Rate-limiter TTL is a pure arithmetic change; assert `ttl > nowSeconds` and within ~2 windows — example test. No new PBT target (PBT N/A for U4; the rate-limiter window PBT is scheduled in U9).

## Security / Resiliency compliance
- **SECURITY-08** (CORS restricted to validated origin): reflect only normalized/validated origins, never raw. ✅
- **SECURITY-15** (fail-closed *where it matters*, resource cleanup, error handling): quota fails closed (U3); rate limiter fails open by explicit, documented decision (abuse dampener, not a boundary); persist/usage failures are caught and logged, reply still served; malformed input → clean 400; no unhandled rejections on the hot path. ✅
- **RESILIENCY-10** (graceful degradation, timeouts): rate-limit/storage failures degrade gracefully instead of erroring the user. (Model-call timeout config is adapter-level — noted; the adapter timeout/retry is a deferred Tier-3 item 3.7, not in U4 scope; U4 ensures the *handler* degrades.) ✅

## Definition of Done
- Chat responses (200/401/429/503/degrade/over-quota) carry CORS headers reflecting the validated origin — tests.
- OPTIONS preflight returns 204 + CORS — test.
- A rate-limit DDB error → request proceeds (fail-open), logged — test.
- A persist/usage failure after a good reply → still 200 with the reply — test.
- Malformed JSON body → 400 (chat + admin) — tests.
- Config cache TTL is 10s — asserted.
- Rate-limiter TTL is epoch-seconds ~2 windows ahead — test.
- Full suite green; typecheck + lint clean.
