# U3 — Functional Design: Quota enforcement + auto kill-switch

**Unit**: U3 · **Findings**: 1.1 · **Requirements**: FR-5.1, FR-5.2
**Extensions**: SECURITY-11 (business-logic abuse / rate limiting), RESILIENCY-10 (graceful degradation).

## Problem (verified)
`incrementUsage` (`ddb.ts:281-`) writes `USAGE#<month>` counters, but **nothing reads them** — grep confirms no quota check anywhere. `killSwitch` is only ever *read* (`chat.ts:67`) and initialized `false`; nothing trips it. So a leaked/abused site key can drive ~600 msg/min indefinitely on the shared model key with no automated stop. This is the single highest-dollar-risk finding (flagged independently by 3 review roles).

## Design

### D1 — a monthly message limit in tenant config
- Add `monthlyMessageLimit?: number` to `TenantConfig` (`ddb.ts`) and map it in `toTenantConfig` (`item.monthlyMessageLimit as number | undefined`).
- Platform default when unset: `DEFAULT_MONTHLY_MESSAGE_LIMIT` (a safe cap, e.g. 10_000/month — enough for a real small tenant, far below the ~25M/month a 600/min attacker could otherwise reach). Sourced as a constant now; per-plan values come with billing (deferred).
- `0` or negative is treated as "use default" (not "unlimited") to fail safe.

### D2 — read usage on the chat path
- New `getUsage(tenantId, month): Promise<number>` in `ddb.ts` — a `GetItem` on `USAGE#<month>` returning the `messages` count (0 if absent). Eventually-consistent read is acceptable: the goal is bounding runaway spend, not exact billing, so a small overshoot within one request window is fine.
- The chat handler reads usage once per request (after the existing suspended/killSwitch check, before the rate-limit + model work) and compares to the effective limit.

### D3 — enforce + friendly over-quota response
- If `usage >= limit`: return a **200** with a tenant-visible over-quota message (not a 4xx — the widget should show a graceful message, consistent with the existing degrade pattern), e.g. *"This assistant has reached its monthly message limit. Please try again later."* Reuse the `ChatMessageResponse` shape (`reply` + `sessionId`) so the widget renders it as a normal bot message.
  - Rationale for 200 over 429: 429 means "slow down, retry soon"; quota exhaustion is "done for the month" — a friendly bot message is the right UX, and it avoids the widget's rate-limit "sending too quickly" copy.
- The message is configurable later (tenant-configurable copy is a nice-to-have; for U3 a clear default string, with a hook to override from config if `config.branding` or a new field is present — keep minimal: a constant now).

### D4 — auto-trip the kill-switch on breach
- When `usage >= limit`, in addition to returning the over-quota reply, **set `killSwitch: true`** on the tenant CONFIG (`UpdateCommand`, `SET killSwitch = :true`) and **clear the config cache** for that tenant so the next request short-circuits at the existing `config.killSwitch` gate (`chat.ts:67`) within the 60s cache window — actually immediately for this container.
  - New `tripKillSwitch(tenantId)` in `ddb.ts`.
  - This bounds worst-case spend: once the month's limit is hit, the tenant is hard-off until an admin resets it (admin reset path already exists via config writes; a dedicated "resume" is a later nicety).
  - Idempotent: setting killSwitch true when already true is a harmless no-op.
- **Ordering**: check quota *before* the model call (never pay for a call over quota). Trip the switch as part of the over-quota branch.

### D5 — interaction with the config cache (relates to 3.8, fully addressed in U4)
- After tripping the kill switch we `clearConfigCache()` (or delete the tenant's entry) so this container re-reads fresh config. Other warm containers still honor the 60s TTL — acceptable for U3 (the hard cache-latency fix is U4/3.8). Worst case: up to 60s of extra messages across other warm containers after the switch trips — bounded and small relative to the monthly limit.

## Interfaces changed
| Symbol | Change |
|---|---|
| `TenantConfig` | + `monthlyMessageLimit?: number` |
| `toTenantConfig` | map the new field |
| `getUsage(tenantId, month)` | new — read USAGE# messages count |
| `tripKillSwitch(tenantId)` | new — SET killSwitch=true |
| chat handler | quota check + over-quota reply + auto-trip |
| `clearConfigCache` / cache | evict tenant on trip |

## Testable Properties (PBT-01)
Quota logic is a discrete threshold comparison (`usage >= limit`) — example-based tests cover the boundary (limit-1 pass, limit block, over block). No round-trip/invariant property warrants PBT here → PBT N/A for U3 (documented).

## Security / Resiliency compliance
- **SECURITY-11** (business-logic abuse, rate limiting): a hard monthly ceiling + auto-kill bounds abuse spend. ✅
- **RESILIENCY-10** (graceful degradation): over-quota returns a friendly bot message, not an error. ✅
- **SECURITY-15** (fail-closed): if the usage read throws, treat as a transient error and fail closed to the existing friendly-degrade path (do NOT fail open and allow unlimited). Decided: a usage-read failure → friendly degrade (200) rather than allowing the model call, so a DDB blip can't bypass the cap. (This coordinates with U4's hot-path hardening.)
- **PBT**: N/A for U3.

## Definition of Done
- Under-limit request proceeds (model called) — test.
- At/over-limit request returns the over-quota reply, does NOT call the model, and trips killSwitch + evicts cache — test.
- `getUsage` returns 0 for a missing counter — test.
- Default limit applies when config has none; 0/negative → default — test.
- Usage-read failure → friendly degrade, not bypass — test.
- Full suite green; typecheck + lint clean.
