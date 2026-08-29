# Implementation Progress

Multi-tenant AI chatbot platform. Phases per `docs/chatbot-platform-implementation-plan.md`.

## Status

| Phase | Description | State |
|---|---|---|
| P0 | Monorepo scaffold + CI/CD | ✅ complete |
| P1 | Widget + session auth | ✅ complete |
| P2 | Chat pipeline + model + one tool | ✅ complete |
| P3 | Abuse protection | ✅ complete |
| P4 | Marketing site + tenant portal v1 | ✅ complete |
| RF | Review-findings remediation (AI-DLC, `fix/review-findings`) | ✅ complete (U1–U9) |

## Gate checklist (each phase)
tests green → reviewer subagent pass → conventional commit → PROGRESS update.

## Review-findings remediation (AI-DLC run)
Docs: `aidlc-docs/`. Scope: Tiers 0–2 + all UI (see `aidlc-docs/inception/reverse-engineering/review-findings.md`). 9 gated units.

### U1 gate — Chat data-layer correctness ✅
- **0.1** `queryHistory` fetches newest `limit` (`ScanIndexForward:false`) then reverses to chronological — no more amnesia.
- **0.2** message sort keys are monotonic ULIDs (`MSG#<ulid>`), collision-free across same-ms writes; `persistMessages` chunks BatchWrite to ≤25 and retries `UnprocessedItems` with backoff, throwing on final failure.
- **0.4** `ensureUserTenant` idempotent: CONFIG always ensured (swallows `ConditionalCheckFailedException`), race path re-reads winning tenant — no orphaned tenants. Seeded default color `#4f46e5`→`#6d5ae6`.
- **3.10** `persistMessages` increments session `messageCount` (user/assistant only) for a truthful portal sessions view.
- Tests: **61 green** (+14: `ddb.test.ts` incl. fast-check PBT for `chunk` + `messageSk` ordering; `admin-ddb.test.ts` idempotency incl. race; isolation updated). typecheck + lint clean.
- Reviewer: pass confirmed ULID ordering, retry-loop partial-failure correctness, monotonic-factory concurrency, idempotency skip-path (agent hit an API error before finishing the last 2 paths; both covered by passing tests incl. PBT).
- Extensions: SECURITY-15 (persist throws, not silent) ✅ · PBT-03/07/08 (chunk + key ordering) ✅ · RESILIENCY-10 N/A (timeouts → U4).

### U2 gate — Widget JWT hardening + Origin binding ✅
- **1.4** JWT public-key cache is now a `Map` keyed by `keyId` with a 10-min TTL (was a single global that ignored keyId → broke rotation/revocation). `sign` emits `kid`; `verify` enforces `kid === keyId`, plus required `iss`/`aud` claims (constants `JWT_ISS`/`JWT_AUD`).
- **1.2** Chat handler binds the bearer token to its origin: rejects (401) when the request Origin ≠ `claims.origin` (both normalized scheme+host). No-Origin server-side replay is rejected.
- **4.7** Chat app only accepts an `https` `apiBase` (`isHttpsUrl`), preventing token redirection to a downgraded/attacker endpoint.
- Tests: **70 green** (+9: kid mismatch, wrong iss/aud, cross-key rejection, keyId-scoped cache, DER→JOSE fast-check PBT, chat origin-binding 401/pass). typecheck + lint clean; widget 1.58KB gz.
- Reviewer: adversarial pass on all 6 scrutiny areas — **no findings ≥80 confidence**; confirmed fail-closed kid/iss/aud, no cache poisoning, origin can't be forged, no legit-token exfil path. Added origin normalization on the compare per a sub-threshold note.
- Extensions: SECURITY-08 (full token validation: sig+exp+ttl+kid+iss+aud+origin) ✅ · SECURITY-11 (defense in depth) ✅ · SECURITY-15 (fail-closed) ✅ · PBT-02 (DER→JOSE round-trip) ✅.

### U3 gate — Quota enforcement + auto kill-switch ✅
- **1.1** Usage counters were written but never read → uncapped model spend on a leaked site key. Now: `TenantConfig.monthlyMessageLimit` (+ `DEFAULT_MONTHLY_MESSAGE_LIMIT=10_000` fallback); `getUsage()` reads `USAGE#<month>`; the chat handler checks usage **before** the model call and, at/over limit, returns a friendly over-quota reply, does NOT call the model, and auto-trips the kill-switch (`tripKillSwitch()` + config-cache eviction) so subsequent requests hard-stop.
- Fail-closed: a usage-read failure degrades to the friendly message (never fail-open into unlimited spend). `0`/negative limit → default (fail-safe, not unlimited).
- Tests: **76 green** (+6: under/at/over limit, default fallback, 0→default, usage-read-fails-closed). typecheck + lint clean.
- Reviewer: traced all paths — "correctly bounds runaway model spend", no findings ≥80. Overshoot bounded (≤60s cross-container cache + 600/min rate limit → a few thousand msgs vs 10k default).
- Extensions: SECURITY-11 (abuse ceiling) ✅ · SECURITY-15 (fail-closed) ✅ · RESILIENCY-10 (graceful over-quota degrade) ✅ · PBT N/A (threshold compare).

### U4 gate — Backend robustness ✅
- **2.6** CORS now on **every** chat response (200/401/400/429/503/degrade/over-quota) + an OPTIONS preflight (204). `widgetCors` reflects only a `normalizeOrigin`'d origin (never raw) — browser can finally read error bodies.
- **2.7** New `allowFailOpen` fails **open** on a rate-limiter infra error (dampener, not a boundary; quota fails closed) but still 429s on a real cap hit. `persistMessages`+`incrementUsage` wrapped so a storage/usage blip can't 500 an already-generated reply.
- **3.8** Config-cache TTL 60s→10s → kill-switch/suspend honored within ~10s (also shrinks U3 cross-container overshoot).
- **3.9** Guarded `JSON.parse` in chat + admin → clean 400 on malformed body.
- **3.13** Rate-limiter TTL is now explicit epoch-seconds (`nowSec + windowSec*2`), no longer relying on the window-index≈epoch coincidence.
- **3.12** (bonus) `/v1/admin/profile` validates via new `ProfileInput` zod schema (max 4000) instead of `typeof`+`.slice`.
- Tests: **86 green** (+10: CORS on success+error, OPTIONS 204, malformed→400, persist-fail-still-200, usage-fail-still-200, fail-open true on infra error / false on cap, TTL epoch). typecheck + lint clean.
- Reviewer: adversarial pass on all 7 questions — no findings ≥80; confirmed no CORS injection, no fail-open/closed gap, no runaway path.
- Extensions: SECURITY-08 (CORS restricted to validated origin) ✅ · SECURITY-15 (fail-closed where it matters, guarded I/O, clean 400s) ✅ · RESILIENCY-10 (graceful degradation on infra errors) ✅ · PBT N/A (rate-limiter window PBT scheduled U9).

### U5 gate — Widget UX (vanilla) ✅
- **0.3 / 4.11** Header close (X) button + Esc key both post `platform:close`; loader hides the frame, returns focus to the launcher, toggles `aria-expanded`, swaps the launcher icon. Mobile trap fixed.
- **4.12** Failed send (429/5xx/network) restores the typed text so it isn't lost.
- **4.13** Unavailable state offers a "Try again" button that re-handshakes.
- **4.14** Hardcoded e-commerce prompts removed; `Branding.suggestedPrompts` (optional) seeded from up to 3 enabled KB titles (session handler, best-effort); widget renders none when absent. Session Lambda gained base-table `Query` (LeadingKeys `TENANT#*`).
- **4.15** Bot links are clickable + XSS-safe (`splitLinks` → text nodes + `<a>` via textContent/href properties, http(s) only, `rel=noopener noreferrer`; trailing punctuation not swallowed); `.msg` gets `overflow-wrap`.
- **4.16** `#log` is `role=log aria-live=polite` so replies are announced.
- **4.17** `contrastOk` validates the tenant brand color vs white; falls back to `#6d5ae6` if unreadable.
- Also `isSafeApiBase` (replaces isHttpsUrl): https OR loopback-http (local/E2E), rejects other http — preserves the U2 4.7 fix while unblocking E2E.
- Tests: **101 green** (+13 widget `util.test`: contrastOk, splitLinks incl. javascript:/punctuation, isSafeApiBase; session suggestedPrompts + best-effort). Handshake E2E green. widget **1.71KB gz**. typecheck + lint clean.
- Reviewer: adversarial pass on 7 points — no findings ≥80; confirmed XSS-safe link rendering, sound loopback exemption, validated postMessage, best-effort KB, correct contrast math, preserved E2E selectors. Applied the sub-threshold punctuation-trim polish.
- Extensions: SECURITY (XSS-safe rendering) ✅ · SECURITY-08 (platform:close validated) ✅ · a11y (aria-live, aria-expanded, Esc, focus return) ✅ · PBT N/A (small-domain pure helpers example-tested).
- NOTE: money-path E2E (dashboard flow) fails on the baseline too — pre-existing mock-dashboard issue, unrelated to U5; U6 (portal rewrite) addresses.

### U6 gate — Portal → React + MUI ✅
- Full framework migration of `packages/dashboard`: vanilla `innerHTML`-string DOM → **React 19 + MUI 6 + react-hook-form + zod** (reusing shared schemas). Widget/marketing untouched.
- **1.3** Stored XSS eliminated structurally (React escaping; zero `dangerouslySetInnerHTML`/`innerHTML`) + a **CI grep gate** so it can't regress.
- **2.9** Every form validates client-side (zodResolver on the shared schemas); submit disabled until valid; inline field errors — no more raw Cognito strings.
- **2.8 / 4.3 / 4.4** Global Snackbar shows success AND error on every mutation (no silent saves). **4.6** embed snippet + site key have Copy buttons. **4.7** color picker defaults to `#6d5ae6`. **4.8** tone Select reflects saved value. **4.9** multi-domain allowlist. **4.5/4.10** signed-in identity shown; auth inputs get autoComplete/inputMode.
- **4.1** Auth is a stepped flow (login ⇄ create-account → verify, email carried, resend); **4.2/4.4** empty states for FAQs + conversations.
- **4.21–4.23** MUI theme mapped from brand tokens (accent `#6d5ae6`, Plus Jakarta Sans); one brand name; consistent transcript bubbles.
- **E2E bypass hardened**: `MODE !== "production" && VITE_E2E`; prod build throws if `VITE_E2E` set; CI E2E uses `build:e2e` (`--mode e2e`). Fail-closed — prod can't carry the bypass.
- Tests: **104 green** (+3 RTL: validation blocks submit, stepped auth). **Both E2E green** — money-path now passes (was baseline-broken because `dist` wasn't built). typecheck + lint clean. XSS gate clean.
- Reviewer: found + I fixed a **Critical** (unmemoized snackbar context re-fired Dashboard's load effect → spinner flash + section remount on every save) and an **Important** (the claimed XSS grep gate didn't exist — now added to CI). Re-verified.
- Extensions: SECURITY-05 (all forms validated) ✅ · SECURITY-08/12 (auth; localStorage tradeoff documented, H1 out of scope, XSS that made it exploitable removed) ✅ · a11y (MUI + autoComplete/inputMode/aria-live snackbar) ✅ · PBT N/A (UI + thin mapping).

### U7 gate — Marketing + CSP + design-system ✅
- **1.5** Per-surface **CSP** via CDK (built from `config.subdomains`, env-independent): cdn/chat/marketing/portal each get an appropriate policy. `script-src` is never `'unsafe-inline'`; `'unsafe-inline'` limited to `style-src` (MUI/emotion, documented). The **chat surface is framable** (`frame-ancestors *`, no `X-Frame-Options` — it's embedded by tenants) while others are `frame-ancestors 'none'` + DENY. Fixes the wrong-XFO-on-chat sub-point.
- **2.10** `tokens.css` is now **imported** by marketing (`main.ts`) and portal (`main.tsx`) — the design system is used, not copy-pasted; marketing's duplicated `:root` block removed (added `@platform/shared` dep). Marketing's page-local `.btn*` overrides scoped under `.wrap` so they win over the imported shared classes (reviewer caught the cascade collision that was silently reverting the AA fix).
- **4.21** `.btn-ghost`/link text → `--color-accent-700` (`#4f3ec0`, ~7:1) — passes WCAG AA.
- **4.18/4.19** Marketing CTAs distinguished: Log in / Get started free (`?mode=signup`, consumed by the portal) / "See how it works" → `#features` anchor; a **"Try the live demo"** button opens the dogfooded widget (graceful fallback). **4.20** responsive nav. **4.22** one brand name ("AI Chatbot").
- Tests: **108 green** (+4 CSP template assertions: 4 policies, no `script-src 'unsafe-inline'`, only chat framable, portal→Cognito). Both E2E green; typecheck + lint + synth clean.
- Reviewer: adversarial pass — confirmed CSP correctness (frame-ancestors * safe: token is unicast via targeted postMessage, not broadcast), script-src strict, env-independent, style-src tradeoff sound; caught **1 Critical** (CSS specificity collision reverting the AA fix in the built artifact) which I fixed (`.wrap`-scoped overrides, re-verified in dist).
- Extensions: SECURITY-04 (CSP + headers per surface, script-src strict, framing correct) ✅ · a11y (AA contrast) ✅ · PBT N/A.

### U8 gate — Deploy pipeline safety ✅
- **2.2** Cache-safe asset publish: `publish()` uploads content-hashed `/assets/*` as `immutable` (add-only, no `--delete`) then the mutable entrypoint (`widget.js`/`chat.html`/`index.html`) as `no-cache`; then invalidate; then `prune()` (`--delete`) runs **after** invalidation — so a client mid-session never requests an asset deleted before its replacement is up. Replaces the old single `sync --delete` pass.
- **2.3** OIDC dev/staging trust changed from `ref:refs/heads/main` → `environment:<env>` (uniform with prod) — a run must enter the matching GitHub Environment (cryptographically enforced, honors required-reviewer rules). Snippet gains `crossorigin="anonymous"`; real SRI deferred (needs versioned widget filename — honestly documented, no fake integrity attr).
- **2.5** Post-deploy **smoke test** polls `/health` until 200 (retries on any non-200 for propagation lag); non-200 fails the run. **Rollback runbook** (version-redeploy from last good SHA) added to README; prod-follows-staging convention documented.
- **3.21** The debug-OIDC step now runs only when the caller passes `debug: true` (new `workflow_call` boolean input, default false) — off the prod critical path.
- Verify: **108 tests green** (unaffected); `deploy.yml` + CFN template valid YAML; typecheck + lint clean.
- Reviewer: adversarial pass on all 7 points — **no findings ≥80**; confirmed OIDC scoping correct + tighter, sync ordering has no missing-asset window, prune preserves headers (mtime skip), smoke gate can't false-pass, debug gating correct, no fake SRI. Applied its sub-threshold note (smoke test now retries on 4xx, not just 5xx).
- Extensions: SECURITY-13 (CI/CD integrity — env-scoped OIDC; SRI partial+documented) ✅ · RESILIENCY-04 (version-redeploy rollback) ✅ · RESILIENCY-06 (post-deploy health check) ✅ · RESILIENCY-15 (smoke gate + rollback runbook) ✅.

### U9 gate — Test backfill + tenant-access guard ✅ (final unit)
- **2.1** App-layer **tenant-access guard** (`assertTenantId` in `packages/shared/src/tenant.ts`): rejects empty/`#`/`*`/`/`/whitespace/control/over-length ids (allows the minted `t_<ulid>` + Cognito forms). Applied to **every** tenant-scoped DDB function in `ddb.ts` + `admin-ddb.ts`. Defense-in-depth over the `LeadingKeys` IAM (not a substitute — documented). Added `assertSessionId` for the composite-key `sessionId` half (admin transcript route takes it from a URL path segment).
- **2.4 / 3.27–3.31** Test backfill: `tenant.test.ts` (guard + fast-check PBT), `rotation.test.ts` (site-key/grace-key lifecycle: new/old/no-op/isolation), `rate-limit.test.ts` (cap-boundary PBT that faithfully simulates the conditional counter — catches `<`→`<=`; + window/TTL invariant PBT), `api-security.test.ts` (CDK template: KMS ECC_NIST_P256 SIGN_VERIFY, admin routes have JWT authorizer, `/health`+`/v1/widget` don't, LeadingKeys present), isolation negatives (malformed tenant/session ids never reach DDB — asserts 0 command calls).
- Tests: **128 green** (+20). Both E2E green; typecheck + lint + synth clean.
- Reviewer: found 2 real gaps (unguarded `sessionId` on an attacker-controlled admin path; `ensureUserTenant`/`ensureTenantConfig` missing the guard despite the DoD) + 1 overstated test (cap-boundary was a string match) — **all three fixed** (sessionId guard + `ensureTenantConfig` guard + a behavior-simulating cap-boundary PBT) and re-verified. Confirmed the regex never rejects a legitimate tenant.
- Extensions: SECURITY-08 (authz/IDOR — guard + negative cross-tenant assertions across every handler path) ✅ · PBT-02/03/07/08 (DER→JOSE round-trip [U2], tenant-id + rate-limiter invariants, domain generators, seed/shrink) ✅.

## RF remediation summary (U1–U9, all committed on `fix/review-findings`)
All in-scope findings (Tiers 0–2 + all UI) from the two review loops are remediated, each gated (design → code → tests → reviewer-subagent pass → conventional commit). Deferred (documented in `aidlc-docs/inception/reverse-engineering/review-findings.md`): most Tier-3 scale/ops items, full billing/Stripe, GDPR deletion (2.11). Final state: **129 unit tests + both Playwright E2E green; typecheck, lint, cdk synth clean**.

### Post-remediation: whole-branch ultrareview fixes
A cloud ultrareview of the full branch caught 3 cross-unit issues the per-unit reviews couldn't (each saw one unit's diff in isolation) — all fixed:
- **Showstopper (bug_001)**: U2's chat origin-binding compared the request Origin to `claims.origin` (the merchant origin), but the chat POST is issued from inside the chat iframe → its Origin is always the **chat CDN**, so the check **401'd every real message in prod**. The per-unit test had fabricated matching origins on both sides. Fixed: the handler now requires the request Origin to be the **chat surface** (`CHAT_ORIGIN`, added to the chat Lambda env) — the real origin allowlisting stays at session-mint. The corrected test proves the actual prod topology (chat-CDN request + merchant token → passes).
- **bug_002**: U5's widget "Try again" only re-posted the cached failed session (loader `platform:ready` → `postToFrame`), so a failed first handshake looped forever. Fixed: `platform:ready` re-runs `handshake()` when the current session failed.
- **bug_003 (nit)**: the portal login form reused the signup password-complexity schema, so a typo showed "Include a number" instead of letting Cognito return "Incorrect email or password". Fixed: split into `loginCredentials` (email + non-empty password) vs `signupCredentials`.

## Open WARNs / TODOs
- [ops] `dynamodb:LeadingKeys: TENANT#*` bounds session+chat Lambdas to tenant partitions but is NOT per-tenant isolation — enforced in app code (JWT/site-key derive tenantId server-side; message PK embeds tenantId). Per-tenant IAM needs request-scoped creds; revisit later. (reviewer P1 #4, P2 #3)
- [P3] `search_products` DDB Query is capped at Limit=200 then filtered in-memory; move to a proper query/index if catalogs grow. (reviewer P2 #5)
- [P4] Loader: require `data-api-base` and validate it's absolute; silent fail-closed if a tenant misconfigures. (reviewer P1 #6)

Resolved in P1: widget now imports `@platform/shared` zod schemas (P0 #2); session Lambda DDB grants scoped with `dynamodb:LeadingKeys` (P0 #3).

## Design system
- Imported the "AI Chatbot design system" (Claude Design) and applied it across all three UIs, keeping existing functionality + copy: purple accent (#6D5AE6), Plus Jakarta Sans + Instrument Serif display, pill buttons, layered elevation.
- Widget: gradient-header panel (26px radius), greeting-as-message + suggested pills, accent user bubbles / typing dots, pill composer, tenant-accent driven from branding color.
- Marketing: nav + hero (serif italic accent) + feature cards, re-skinned.
- Portal: token-based cards, inputs, buttons, transcript bubbles.
- Canonical tokens live in `packages/shared/design/tokens.css` (exported as `@platform/shared/design/tokens.css`); each static bundle inlines its own copy to stay dependency-free. Both Playwright suites (handshake + money-path) green after the restyle.

## P4 gate
- Marketing static site (`www`): hero/features/CTA, dogfoods its own widget via a demo tenant key (Vite env-injected).
- Cognito user pool (email verify, SRP-only) + post-confirmation trigger creates USER#/TENANT# records (condition-guarded, no overwrite).
- Portal SPA (`app`): signup/verify/login, setup wizard (basics+domains → appearance → business profile + FAQ, 50×2KB byte-capped), sessions list + transcript.
- Admin API (`/v1/admin/{proxy+}`) behind a Cognito JWT authorizer; tenant derived from the `sub` claim server-side, never client input. All admin DDB ops keyed off the server-derived tenantId.
- Key issuance gated server-side (≥1 domain + profile + ≥1 KB entry); plaintext shown once, SHA-256 stored; rotation keeps the old key alive via a `GRACEKEY#` GSI item with a 24h TTL.
- KB entries + business profile assembled into the system prompt (static-first for caching, 12KB cap, oldest-first eviction with a `capped` flag).
- Tests: admin handler (auth, tenant-from-sub, key gate, hash-not-plaintext), prompt assembly, isolation suite extended to admin routes (13 tests total). Playwright money-path: signup→wizard→key→embed→FAQ-grounded answer→transcript.
- Reviewer: 0 BLOCKER, 3 WARN all fixed (KB byte-cap via TextEncoder, URL-decode+validate path ids, dropped USER_PASSWORD_AUTH).

## P3 gate
- Rate limits both axes (DDB atomic fixed-window counter, conditional-update cap): per-session 10/min, per-tenant 600/min, checked before the model call → 429 + retry-after; widget shows a slow-down message.
- Edge protection: CLOUDFRONT WAF ACL on all four distributions (IP rate rule 1000/IP + AWS CommonRuleSet) + API Gateway stage throttling (100 rps / 200 burst). (WAFv2 can't attach to an HTTP API, so the API uses stage throttling + the DDB rate limits below rather than a WebACL.)
- Kill-switch honored ≤60s via the 60s config cache TTL (P2).
- Structured JSON logs on every chat: tenant, session, model, tokensIn/Out, latencyMs (no message body / token / key).
- CloudWatch dashboard (p50/p95 latency, invocations/errors, DDB throttles) + alarms (chat error rate, p95 latency, DDB throttles) → SNS topic, all via CDK.
- Cross-tenant isolation suite (10 tests) runs as its own ci.yml step: positive + negative assertions that tenant A never reaches tenant B's config/products/messages/sessions/usage/rate-counters.
- Reviewer: 1 BLOCKER (isolation suite lacked negative cross-tenant assertions) fixed + re-verified; accepted-risk note: LeadingKeys is a prefix guard, isolation is app-layer.

## P2 gate
- `POST /v1/chat/message`: JWT verify (ES256 pinned, exp≤60m enforced) → cached tenant config (60s TTL, killSwitch honored) → history Query → prompt assembly → adapter → tool loop (≤5) → BatchWrite persist w/ token counts + usage counter.
- Provider-agnostic adapter (OpenAI-compatible `complete(messages, tools)`): Anthropic (Claude Haiku) + Mock. `search_products` tool against seeded dummy catalog (per-tool timeout 8s, 4KB size cap).
- Message history + persistence partitioned under `TENANT#<id>#SESSION#<sid>` — IAM `LeadingKeys: TENANT#*` genuinely scopes; app binds session→tenant from JWT.
- MODEL_API_KEY read from Secrets Manager (imported by ref, never in template/code); chat degrades to friendly message + structured error log when adapter throws.
- Widget chat UI: message list, send, typing, text-sanitized replies.
- Tests: 21 backend unit incl. scripted tool-call convo, loop cap, JWT verify (valid/expired/tampered/alg/ttl), degradation.
- Reviewer: 3 BLOCKER (session→tenant binding at app+IAM+key layers, exp-iat TTL cap) fixed + re-verified; 2 WARN above.

## P1 gate
- Loader: IIFE, currentScript+fallback, shadow-DOM bubble, lazy iframe, KMS-JWT handshake on merchant origin, postMessage→iframe (origin+source pinned). 1.24KB gz ≤30KB.
- `POST /v1/widget/session`: GSI hashed-site-key lookup, server-side origin allowlist, KMS ES256 JWT (exp ≤60m). Seed script for dev tenant.
- Infra: KMS ECC_NIST_P256 sign key, session Lambda (LeadingKeys grant), Edge stack (S3+CloudFront OAC for cdn+chat, security headers).
- Tests: 12 unit (origin, KMS-JWT verifies with real EC key, session handler 403 paths) + 2 Playwright (allowed→connected, foreign→403→unavailable).
- Reviewer: 3 BLOCKER (postMessage token exfil ×2, CORS origin reflection) all fixed + re-verified; 3 WARN above.

## P0 gate
- ci:local green: lint · typecheck · vitest (3) · widget build+size (0.35KB gz ≤30KB) · cdk synth.
- Reviewer pass: 0 BLOCKER, 5 WARN. Fixed: prod trigger decoupled from staging tag (#1), cdk.context.json untracked+ignored (#4), CI synth uses stub zone id / no fromLookup (#5). Deferred to P1: #2, #3 (above).

## Blockers
_(none)_
