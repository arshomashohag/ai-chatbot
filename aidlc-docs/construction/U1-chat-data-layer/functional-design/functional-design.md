# U1 — Functional Design: Chat data-layer correctness

**Unit**: U1 · **Findings**: 0.1, 0.2, 0.4, 3.10 · **Requirements**: FR-1.1…1.4, FR-3.8-enable

## Problem statements (verified in code)
1. **0.1 — history amnesia** (`ddb.ts:158-173`): `queryHistory` uses `Limit: 20` with no `ScanIndexForward`, so DynamoDB returns the **oldest** 20 messages by sort key. After ~6 turns the model only ever sees the conversation's opening.
2. **0.2 — message data loss** (`ddb.ts:184-206`, `keys.ts:24`): sort key is `MSG#<baseIso>#<idx>` where `baseIso` is one timestamp for the whole request and `idx` resets to `0000` each request. Two requests in the same millisecond collide (`#0000` overwrites). A single `BatchWriteCommand` also (a) hard-fails >25 items — reachable via the 5-iteration tool loop — and (b) silently drops `UnprocessedItems`.
3. **0.4 — orphaned tenant** (`admin-ddb.ts:49-85`): `ensureUserTenant` does `if (existing) return existing` after the profile put; if the CONFIG put failed on the first invocation, the Cognito retry returns early and the CONFIG is never created.
4. **3.10 — messageCount** (`ddb.ts:100-121`): `putSession` writes no counter; nothing increments it; portal always shows 0.

## Testable Properties (PBT-01)
| Component | Property | Category |
|---|---|---|
| `messageSk(iso, ulid)` | strictly increasing over generation order (ULIDs monotonic within ms) | Invariant (ordering) |
| history round-trip | `reverse(queryNewestFirst(persist(msgs)))` preserves chronological order + all elements | Invariant (size + order preservation) |
| `chunk(items, 25)` | concatenation of chunks == input; every chunk ≤ 25; count = ceil(n/25) | Invariant |
| `ensureUserTenant` | idempotent: calling twice with same sub yields one tenant, config always present | Idempotence |

PBT (Partial mode) applies to `chunk` (invariant) and `messageSk` ordering (invariant) — both pure. History round-trip and idempotency are stateful/IO → covered by example-based tests with `aws-sdk-client-mock` (PBT-06 N/A, no in-memory model warranted here).

## Design

### D1 — history ordering (0.1)
`queryHistory` gains `ScanIndexForward: false` to fetch the **newest** `limit` items, then reverses the result to chronological (oldest→newest) order before returning — the order the model expects. Signature unchanged (`queryHistory(tenantId, sessionId, limit=20)`), so `chat.ts:74` caller is untouched.

Note: default `limit` stays 20 for this unit (token-aware windowing is deferred Tier-3 / H3). This unit fixes *which* 20, not *how many*.

### D2 — collision-free message keys (0.2)
- `packages/shared` stays dependency-free (only `zod`). `messageSk` remains a **pure** function but its second argument becomes a caller-supplied unique id: `messageSk(isoTs, id)` (already this shape — `keys.ts:24`). We keep the signature; the fix is in the **caller** generating a unique, monotonic id.
- `persistMessages` (backend, has `ulid`) generates **one ULID per message** at persist time. ULIDs are lexicographically sortable and monotonic within the same millisecond (the `ulid` lib's monotonic factory). Sort key becomes `MSG#<ulid>` — dropping the ambiguous `baseIso#idx` scheme entirely. Rationale: ULID already encodes a millisecond timestamp as its high bits, so `MSG#<ulid>` sorts chronologically **and** is globally unique, killing the same-ms collision. `baseIso` param is removed from `persistMessages` (caller updated).
- To preserve monotonic ordering across messages in one batch, use `ulid`'s `monotonicFactory()` so successive calls in the same ms increment.

**Contract change**: `persistMessages({ tenantId, sessionId, messages })` — `baseIso` dropped. `chat.ts` caller updated (it still computes `baseIso` for the usage month — that stays local to the usage call).

**Key-scheme migration note**: old items under `MSG#<iso>#<idx>` and new items under `MSG#<ulid>` coexist in the same partition; `begins_with(SK, "MSG#")` still matches both. Old items sort before new ones (ISO-8601 `2026-...` vs Crockford-base32 ULID starting with `0`/`7`...). ⚠️ **Ordering caveat**: a ULID's first char is `0`–`7` (48-bit ms since epoch), which sorts *before* ASCII digit `2` of an ISO timestamp — so pre-existing history would sort *after* new messages. Acceptable because: (a) sessions are short-lived (60-min TTL) so mixed-scheme sessions drain within an hour; (b) this is dev/staging pre-launch (no production data). Documented as accepted; no backfill needed.

### D3 — BatchWrite chunking + retry (0.2)
New internal helper `chunk<T>(arr, size=25)` (pure). `persistMessages` loops chunks, and after each `BatchWriteCommand` inspects `UnprocessedItems`, retrying them with exponential backoff (a few attempts) before giving up. On final failure it throws — but the **caller** (fixed in U4 for the served-reply decoupling; here we at least make persist itself correct). For U1, `persistMessages` correctness = never exceed 25/batch, always drain `UnprocessedItems`.

### D4 — idempotent tenant provisioning (0.4)
Rewrite `ensureUserTenant` so the CONFIG put is **always attempted** independent of the profile check:
- Attempt profile put with `attribute_not_exists(PK)`; swallow `ConditionalCheckFailedException` (profile already exists).
- Read/derive the tenantId (from the just-written or existing profile).
- **Always** attempt the CONFIG put with `attribute_not_exists(PK)`; swallow `ConditionalCheckFailedException` (config already exists).
- Return tenantId.

This guarantees: repeated invocation with the same sub → exactly one tenant, and the CONFIG always exists even if a prior invocation died between the two puts. (A `TransactWriteItems` alternative was considered but rejected: the two items share no partition and the conditional-put-swallow pattern is simpler and equally correct for idempotency.)

Also fix the seeded default color here: `#4f46e5` → `#6d5ae6` (brand) to pre-empt finding 4.7 at the source (portal also fixes the picker in U6).

### D5 — messageCount (3.10)
`persistMessages` additionally issues an atomic `UpdateCommand` on the SESSION item (`PK=TENANT#<t>`, `SK=SESSION#<sid>`) with `ADD messageCount :n` where `:n` = count of user/assistant messages in the batch. This runs alongside the message puts. `putSession` initializes nothing (ADD creates the attribute). Portal (U6) then reads a truthful count.

## Interfaces changed
| Symbol | Before | After | Callers to update |
|---|---|---|---|
| `queryHistory` | oldest-N | newest-N reversed to chronological | none (signature same) |
| `persistMessages` | `{tenantId,sessionId,baseIso,messages}` | `{tenantId,sessionId,messages}` | `chat.ts:112` |
| `ensureUserTenant` | early-return skips config | always-ensure config | none (same signature) |
| `messageSk` | `MSG#<iso>#<id>` | unchanged signature; caller passes ULID | internal |

## Security/Resiliency/PBT compliance (this unit)
- **SECURITY-15** (fail-closed, error handling): `persistMessages` retry loop must not swallow the final failure silently — it throws; the served-reply decoupling is U4. Compliant for U1 scope.
- **SECURITY-05** (input validation): unchanged; message content already zod-bounded upstream.
- **RESILIENCY-10** (timeouts): DDB SDK default timeouts apply; explicit timeouts are U4. N/A for U1.
- **PBT-03/PBT-07/PBT-08** (invariant, generators, shrinking): `chunk` + `messageSk` ordering get fast-check property tests with domain generators + seed logging. **Blocking for U1.**

## Definition of Done
- `queryHistory` returns most-recent `limit`, chronological order — unit test.
- Same-ms double-persist does not overwrite — unit test (two persists, distinct SKs, both survive).
- >25-item batch splits and drains `UnprocessedItems` — unit test.
- `ensureUserTenant` idempotent + config-always-present on retry — unit test.
- `messageCount` incremented — unit test.
- PBT: `chunk` + `messageSk` ordering pass with fast-check.
- Existing suites (chat-engine, isolation, etc.) still green; typecheck + lint clean.
