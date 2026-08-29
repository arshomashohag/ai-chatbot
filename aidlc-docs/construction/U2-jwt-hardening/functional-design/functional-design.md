# U2 — Functional Design: Widget JWT hardening + Origin binding

**Unit**: U2 · **Findings**: 1.2, 1.4, 4.7 · **Requirements**: FR-4.1, FR-4.3, FR-4.7
**Extensions**: SECURITY-08 (token validation: signature/exp/aud/iss), SECURITY-11 (defense in depth).

## Problems (verified in code)
1. **1.4 — key cache ignores keyId; no kid/iss/aud** (`jwt-verify.ts:6-9`, `jwt.ts:42`, `contracts/jwt.ts:3-9`): `cachedKey` is a single module-global, returned for any `keyId`. Header has only `alg`/`typ` — no `kid`. Claims lack `iss`/`aud`. → KMS rotation silently breaks verification for warm containers; revocation defeated; no in-token binding to purpose/issuer.
2. **1.2 — token not Origin-bound** (`session.ts:70` mints `origin`, `chat.ts` never checks it): the bearer token is replayable from any origin/curl. The `origin` claim is decorative.
3. **4.7 — apiBase redirect** (`chat/main.ts:129`): the chat app takes `apiBase` from the postMessage payload; combined with a URL-supplied `parentOrigin`, a page framing the chat could point the bearer token at an attacker `apiBase`. Narrow (token only comes from the real parent handshake) but a token-exfil vector.

## Design

### D1 — kid in header + keyId-scoped, TTL'd public-key cache (1.4)
- **Sign** (`jwt.ts`): header becomes `{ alg, typ, kid }` where `kid = keyId` (the KMS key id passed to `signWidgetJwt`). No claim/behaviour change otherwise.
- **Verify** (`jwt-verify.ts`): replace the single `cachedKey` with a `Map<string, { key: KeyObject; fetchedAt: number }>` keyed by `keyId`, with a TTL (e.g. 10 min) so rotation is picked up by warm containers.
  - Read `header.kid`; require it to **equal the expected `keyId`** passed to `verifyWidgetJwt` (reject mismatch → `JwtError`). This binds the token to the configured signing key and blocks a token signed by a different key from validating against the wrong cached entry.
  - Keep the existing `alg === ES256` check (already rejects `alg:none`).
- Rationale: a `Map` keyed by keyId + TTL means (a) two key ids never share a cached key, (b) rotation invalidates within the TTL, (c) `kid` enforcement gives an explicit in-token assertion of which key must verify it.

### D2 — iss + aud claims (1.4)
- Add `iss` and `aud` to `WidgetClaims` (`contracts/jwt.ts`) as required strings. Introduce constants `JWT_ISS` (e.g. `"chatbot-widget"`) and `JWT_AUD` (e.g. `"chatbot-chat-api"`) in shared.
- **Sign**: session handler includes `iss: JWT_ISS, aud: JWT_AUD` in the minted claims.
- **Verify**: after schema parse, enforce `claims.iss === JWT_ISS && claims.aud === JWT_AUD` → `JwtError` on mismatch. This pins the token to this issuer + audience, so a token minted for another purpose (future services sharing the verify key) can't be replayed here.
- **Migration note**: existing in-flight tokens (≤60 min TTL, pre-launch) lack iss/aud and will fail the new required-claims parse → 401 → widget re-handshakes. Acceptable (short TTL, no prod users).

### D3 — Origin binding on the chat path (1.2)
- Chat handler reads the request Origin (`event.headers.origin`) and requires it to **equal `claims.origin`**. On mismatch → 401 (same shape as invalid token). This is defense-in-depth: browser bearer tokens are inherently exfiltratable, but a stolen token replayed from a different origin (or a no-Origin server-side curl) is now rejected.
- **Edge case**: non-browser clients send no `Origin` header. Since the widget always runs in a browser (which always sends `Origin` on cross-origin POST), a missing/blank Origin is treated as a mismatch → 401. Documented: this endpoint is browser-only by design.
- Precedence: origin check runs right after JWT verification, before rate-limit/model work (fail fast, cheapest).

### D4 — apiBase hardening in the chat app (4.7)
- The chat app (`chat/main.ts`) currently trusts `data.apiBase` from the session postMessage. Harden: the chat app derives its API base from a **trusted source** rather than the message payload. Options considered:
  - (a) Pass `apiBase` as a query param the loader controls (still attacker-controllable if the page is framed directly).
  - (b) **Chosen**: the chat app only accepts `apiBase` from a message whose `ev.origin === parentOrigin` AND `ev.source === window.parent` (already enforced), AND additionally validate that `apiBase`, if present, is a well-formed absolute https URL; reject otherwise. The token is only ever sent to that validated base. Since the real token only arrives from the genuine parent handshake, and the parent is the merchant's own page, this closes the "attacker frames chat with malicious apiBase + injected token" path by ensuring a malformed/downgrade base is rejected.
  - Belt-and-suspenders (widget stays vanilla, minimal change): validate `apiBase` is `https:` and a parseable URL before any fetch uses it; if invalid, render unavailable.

## Interfaces changed
| Symbol | Change | Callers |
|---|---|---|
| `WidgetClaims` (shared) | + `iss`, `aud` required | session (mint), jwt-verify (check) |
| `JWT_ISS`, `JWT_AUD` (shared) | new constants | session, jwt-verify |
| `signWidgetJwt` | header gains `kid` | session (unchanged call) |
| `verifyWidgetJwt` | kid + iss + aud enforcement; Map cache | chat, (tests) |
| chat handler | origin-binding check | — |
| chat/main.ts | validate apiBase | — |

## Testable Properties (PBT-01)
| Component | Property | Category |
|---|---|---|
| DER→JOSE (`derToJoseEs256`) | round-trips a valid signature to 64 bytes; r/s padding correct incl. 0x00-prefixed | Round-trip (PBT-02) |
DER→JOSE round-trip is the PBT target for this unit (PBT-02, blocking). kid/iss/aud/origin checks are discrete branches → example-based tests.

## Security compliance (this unit)
- **SECURITY-08** (token validation server-side, every request): signature + exp + ttl + **kid + iss + aud + origin** now all enforced. ✅
- **SECURITY-11** (defense in depth): origin binding layered on top of signature verification. ✅
- **SECURITY-15** (fail-closed): all new checks throw `JwtError` → 401; no fail-open. ✅
- **PBT-02** (round-trip): DER→JOSE property test. ✅ blocking.

## Definition of Done
- Verify rejects: kid mismatch, wrong iss, wrong aud, origin mismatch, (still) alg:none/expired/ttl — unit tests.
- Cache is keyed by keyId + TTL — unit test (two keyIds → two GetPublicKey calls; same keyId within TTL → one).
- Sign emits kid/iss/aud — unit test.
- Chat handler 401s on origin mismatch and on missing Origin — unit test.
- chat/main.ts rejects a non-https/malformed apiBase — covered by widget logic (unit or asserted via existing E2E path).
- DER→JOSE PBT passes.
- Full suite green; widget < 30KB gz; typecheck + lint clean.
