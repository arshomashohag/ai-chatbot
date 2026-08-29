# Consolidated Review Findings — Multi-Tenant AI Chatbot Platform

**Status**: Master issue inventory. Source of all remediation work in this AI-DLC run.
**Date**: 2026-08-29
**Method**: Two review loops.
1. **8-role parallel panel** — Architecture/systems, Security, Backend correctness, Infra/DevOps, UI/UX, Frontend engineering, Testing/QA, Product/cost (FinOps). Each read the real source read-only.
2. **Focused UI/UX re-review** — deep pass on the portal, widget, and marketing UIs after the user flagged the auth flow, missing client-side validation, and absence of a modern UI framework.

**How to read severity**: Ranked by real-world impact, not the individual reviewers' internal labels. **Cross-confirmed** = independently reported by ≥2 roles (higher confidence). Each item carries a stable ID (`TIER.N`) used by the requirements, plan, and units docs.

> **Caveat**: These are reviewer findings verified against the code by reading the cited files, but not yet verified against a running system. A few severities depend on facts to confirm during Construction (e.g. whether dev/staging share one AWS account, exact reachability of the BatchWrite 25-item limit).

---

## Executive summary

The engineering is **solid and honest** — correct CORS reflection, hashed site keys, server-derived `tenantId`, no secret leakage, XSS-safe chat rendering, real OIDC, sub-30KB widget. But the platform is a **complete Phase 0–4 demo, not a runnable SaaS**, and it carries:

- **Live correctness bugs** that malfunction on normal use (chat amnesia, message data loss, mobile trap, orphaned tenants).
- **Critical security & cost-safety gaps** (uncapped model spend, unbound bearer token, portal stored XSS, JWT key-cache rotation break, no CSP).
- **A UI built with no framework, no validation, and a copy-pasted-but-unused design system** — the root cause of most UX problems.
- **A missing commercial/cost-safety layer** (no billing, no quota enforcement, no GDPR deletion).

---

## Tier 0 — Live bugs that break the product now

| ID | Issue | Cross-confirmed by | Location |
|---|---|---|---|
| **0.1** | **Chat history fetched oldest-first, capped at 20.** `queryHistory` has no `ScanIndexForward: false`, so after ~6 turns the bot permanently sees only the *opening* messages → amnesia. | Architecture + Backend | `packages/backend/src/lib/ddb.ts:158-182` |
| **0.2** | **Message-write data loss.** All messages in a turn share one `baseIso` timestamp + index `0000…`; two sends in the same millisecond overwrite each other. A 5-iteration tool loop can exceed BatchWrite's 25-item limit → whole persist throws *after* the reply is generated → 500 + lost reply. `UnprocessedItems` silently dropped. | Backend | `ddb.ts:184-206`, `packages/shared/src/keys.ts:24` |
| **0.3** | **Widget can't be closed on mobile; Esc does nothing.** Fullscreen iframe covers the only launcher; no header close button. User is trapped. | UI/UX (both loops) | `packages/widget/src/loader.ts:124-137`, `packages/widget/chat.html:312-334` |
| **0.4** | **Post-confirmation not idempotent.** If profile write succeeds but tenant-config write fails, Cognito retry sees the profile and returns early → user permanently points at a nonexistent tenant; dashboard never works. | Backend + QA | `packages/backend/src/lib/admin-ddb.ts:49-85`, `handlers/post-confirmation.ts` |

---

## Tier 1 — Critical security & cost-safety

| ID | Issue | Cross-confirmed by | Location |
|---|---|---|---|
| **1.1** | **Uncapped model spend.** Usage counters are *written but never read* — no quota enforcement anywhere. A leaked/abused site key (public by design) can drive ~600 msg/min ≈ **$1–2K/day per tenant** on the single shared API key, with no automated stop; kill switch is manual. | Product + Architecture + Security (3) | `handlers/chat.ts:53-71`, `ddb.ts:208` |
| **1.2** | **Widget bearer token not bound to Origin.** Session mints an `origin` claim; chat never checks it. A token captured once from an allowed page replays from curl anywhere. Amplifies 1.1. | Security + QA | `handlers/chat.ts:31-44`, `handlers/session.ts:67-73` |
| **1.3** | **Portal stored XSS → account takeover.** Dashboard interpolates tenant config into `innerHTML` unescaped (sibling paths *do* escape — clear miss). Chained with Cognito tokens in `localStorage`, it's a portal-takeover primitive. | Frontend | `packages/dashboard/src/main.ts:85-133`, `auth.ts:9-12` |
| **1.4** | **JWT key cache ignores `keyId`; no `kid`/`iss`/`aud`.** Warm containers verify against the *first* key loaded forever → KMS rotation silently breaks verification and defeats revocation. | Security + Architecture + Backend + QA (4) | `lib/jwt-verify.ts:6-18`, `lib/jwt.ts:42`, `shared/src/contracts/jwt.ts` |
| **1.5** | **No CSP on any surface.** Chat iframe holds the bearer token in JS and loads third-party fonts; nothing bounds exfiltration if injection lands. `X-Frame-Options: DENY` on the chat surface is the wrong control — should be CSP `frame-ancestors`. | Security + Frontend | `infra/lib/edge-stack.ts:45-59`, all three `index.html`/`chat.html` |

---

## Tier 2 — High severity (structural)

| ID | Issue | Cross-confirmed by | Location |
|---|---|---|---|
| **2.1** | **IAM `LeadingKeys: TENANT#*` is documentation, not isolation.** Shared role → zero cross-tenant boundary; one derivation bug = full breach with no backstop. | Architecture + Security + Product (3) | `infra/lib/api-stack.ts:107-171,233-249` |
| **2.2** | **Deploy pipeline can serve broken assets.** `s3 sync --delete` removes in-flight hashed chunks in the same pass it uploads new ones; no split cache policy for HTML vs immutable assets; invalidation races propagation. | Infra | `.github/workflows/deploy.yml:113-135`, `edge-stack.ts:171` |
| **2.3** | **OIDC dev/staging trust = `refs/heads/main`, not an environment.** Any workflow on main can assume the deploy role and overwrite `widget.js` for every tenant (supply-chain single point; no SRI). | Infra + Security | `infra/bootstrap/github-deploy-role.yaml:53-60,79-88` |
| **2.4** | **Chat handler has zero tests**; the "money-path" E2E tests a hand-written mock, not the real pipeline (auth bypassed via `VITE_E2E`). Killswitch/429/degrade/401 all unverified. | QA | `handlers/chat.ts` (untested), `e2e/money-server.mjs` |
| **2.5** | **No rollback / no post-deploy smoke gate / prod not gated on staging.** A broken build ships straight to prod undetected. | Infra | `.github/workflows/deploy-prod.yml`, `deploy.yml` |
| **2.6** | **CORS headers missing on all error responses**; no preflight handler → widget sees opaque failures on 4xx. | Security + Backend + QA (3) | `packages/backend/src/lib/http.ts:15-22`, `handlers/session.ts` |
| **2.7** | **Rate-limit/usage failures 500 the user.** Both on the hot path, unguarded; a DDB blip on the (hot single-item) limiter returns raw 5xx instead of degrading. No streaming + 30s Lambda timeout (plan wanted 60s) risks timeouts on multi-tool turns. | Architecture + Backend | `handlers/chat.ts:60-71,118-123`, `infra/lib/lambda.ts:31` |
| **2.8** | **Dashboard: saves fail silently** (no `.catch`); **embed snippet — the product's whole point — has no copy button, shows once**; **three-form auth wall** with no onboarding/empty states; **color default `#4f46e5` ≠ brand `#6d5ae6`**; **tone `<select>` never reflects saved value**. | UI/UX (both loops) | `packages/dashboard/src/main.ts` |
| **2.9** | **No client-side validation anywhere.** Every handler reads `.value.trim()` and POSTs immediately; users get raw Cognito exception strings back. Inputs don't use native constraints (`type=email/url/color`, `required`, `pattern`). | UI/UX (focused loop) | `dashboard/src/main.ts:47-75,159-185` |
| **2.10** | **Design system copy-pasted, not imported.** `tokens.css` component classes (`.btn/.input/.card/.table/.tag/.seg`) are never used; each UI reimplements them inline → drift. `#6D5AE6` on white ≈ 3.7:1 (fails WCAG AA for text). No UI framework (portal is `innerHTML` strings + full re-render). | UI/UX (both loops) | `packages/shared/design/tokens.css` (unused), all three UIs |
| **2.11** | **No GDPR deletion / no data retention.** Chat messages (end-user PII) persist forever with no TTL, no export, no delete path. Blocks compliance-sensitive customers. | Product + Architecture | `handlers/admin.ts`, `ddb.ts:184` |

---

## Tier 3 — Medium (scale, robustness, ops)

**Scale / data model**
- **3.1** Hot partitions: per-tenant rate counter + monthly usage counter are single items → throttle under load. `rate-limit.ts:19-20`, `ddb.ts:208`. (Architecture)
- **3.2** `searchProducts` scans 200 then filters in-memory → wrong/partial results >200 products; ignores `limit`. `ddb.ts:130-156`. (Backend + Architecture)
- **3.3** `listKb`/`getTranscript` never paginate (`LastEvaluatedKey` ignored) → truncated transcripts, wrong KB on hot path. `admin-ddb.ts:164-179,286-306`. (Backend)
- **3.4** `addKb` 50-entry cap is a read-then-write TOCTOU race. `admin-ddb.ts:181-197`. (Backend)
- **3.5** GSI1 projects `ALL` and mixes entity types → storage/WCU inflation, feeds C1 item-collection limit. `data-stack.ts:38-43`. (Architecture)
- **3.6** Unbounded message-history growth (TTL-less) → item-collection 10GB ceiling risk + monotonic storage/PITR cost. `ddb.ts:184-206`. (Architecture + Product)

**Backend robustness**
- **3.7** Model adapter not truly provider-agnostic (hardcoded `new AnthropicAdapter`, no factory), no timeout/retry, new client per invocation. `handlers/chat.ts:85`, `lib/adapter/*`. (Architecture + Backend)
- **3.8** Kill-switch/suspend bypass window up to 60s from config cache; no `ConsistentRead`. `config-cache.ts:8`. (Security + Backend)
- **3.9** Unguarded `JSON.parse` in chat/admin handlers → 500 instead of 400. `handlers/chat.ts:47`, `admin.ts:63`. (Backend)
- **3.10** `messageCount` in session summaries never written → always 0 in portal. `admin-ddb.ts:281`. (Backend + UI/UX)
- **3.11** Grace-key rotation keeps a leaked key valid 24h+ (TTL best-effort) with no early-revoke. `admin.ts:25`, `admin-ddb.ts:208-260`. (Security)
- **3.12** `/v1/admin/profile` bypasses zod (`.slice(0,4000)` only) → unbounded stored-prompt-injection into own bot. `admin.ts:91-96`. (Security)
- **3.13** Rate-limiter TTL computed from window-index not epoch seconds — fragile landmine. `rate-limit.ts:34-36`. (Backend)

**Infra / ops**
- **3.14** Lower-env buckets `RETAIN` → recreation blocked (`BucketAlreadyOwnedByYou`). `edge-stack.ts:141-142`. (Infra)
- **3.15** No DDB backups beyond prod-only PITR; no deletion protection; single-region SPOF. `data-stack.ts:29-31`. (Infra + Architecture)
- **3.16** No API GW / WAF / CloudFront access logs; no X-Ray tracing. `api-stack.ts`, `lambda.ts`. (Infra)
- **3.17** No Lambda reserved concurrency; no DLQ on Cognito post-confirm trigger. `lambda.ts`, `api-stack.ts:182-205`. (Infra)
- **3.18** No budget/cost alarms; SNS alarm topic has no subscriber. `observability-stack.ts`. (Infra + Product)
- **3.19** CloudFront cert region only enforced by pipeline env, not asserted in stack. `edge-stack.ts:156-160`. (Infra)
- **3.20** SPA `403/404 → 200 index.html` masks real errors / hurts SEO (esp. marketing). `edge-stack.ts:175-181`. (Infra)
- **3.21** Debug OIDC step permanent in prod pipeline (claims not secret, but clutter). `deploy.yml:44-67`. (Infra + Security)

**Frontend engineering**
- **3.22** `apiBase` taken from URL query can redirect the bearer token to an attacker origin. `widget/src/chat/main.ts:129`. (Frontend — borderline High)
- **3.23** No `fetch` timeouts / `AbortController` anywhere → hung requests. `loader.ts`, `chat/main.ts`, `api.ts`. (Frontend)
- **3.24** Widget has no teardown / multiple-instance guard → listener + DOM leak on SPA re-inject. `loader.ts:82-146`. (Frontend)
- **3.25** `VITE_E2E` auth bypass only "off by omission" — no positive `PROD` guard. `dashboard/src/auth.ts:52-56`. (Frontend + QA)
- **3.26** Widget bundle has no SRI, no versioned filename → supply-chain + cache-bust risk. `marketing/src/main.ts:21-26`, `widget/vite.config.ts`. (Frontend)

**Testing / QA**
- **3.27** JWT verifier: no algorithm-confusion / cross-key / DER-padding tests. `jwt-verify.test.ts`. (QA)
- **3.28** Rate limiter: no cap-boundary / race / TTL / window-rollover tests. `rate-limit.test.ts`. (QA)
- **3.29** Site-key rotation / grace-key lookup untested. `ddb.ts:63-84`. (QA)
- **3.30** Post-confirmation idempotency untested. `admin-ddb.ts:49`. (QA)
- **3.31** CDK stacks: only DataStack tested (2 trivial assertions); no authorizer-coverage / WAF / KMS-spec template assertions. `infra/lib/stacks.test.ts`. (QA)
- **3.32** No coverage thresholds; verify deploy is gated on CI success. `vitest` config, `ci.yml`, `deploy.yml`. (QA)

---

## Tier 4 — UI/UX detail (from the focused re-review)

**Portal / dashboard** (`packages/dashboard`)
- **4.1** Auth = 3 forms stacked (signup/verify/login), no step flow, email not carried signup→verify, no forgot-password/resend. `main.ts:21-45`.
- **4.2** No UI framework → `app.innerHTML` string per screen; full-page re-render on every mutation wipes unsaved fields + scroll. `main.ts:7-9,184,189`.
- **4.3** Raw Cognito exception strings shown to users. `main.ts:54,64,73`.
- **4.4** No empty states (zero FAQs / zero sessions render blank divs). `main.ts:119,130`.
- **4.5** No onboarding / no progress indicator / no logged-in identity shown. `main.ts:78-136`.
- **4.6** Embed snippet has no copy button; shown once; `word-break:break-all` makes selection fiddly. `main.ts:192-202`.
- **4.7** Color = free text, default `#4f46e5` (wrong brand); should be color picker. `main.ts:101`.
- **4.8** Tone `<select>` never reflects saved value. `main.ts:103-107`.
- **4.9** "Allowed domain (one URL)" truncates array to 1, unexplained. `main.ts:93,163`.
- **4.10** A11y: verify code lacks `inputmode=numeric`/`autocomplete=one-time-code`; passwords lack `autocomplete` tokens; error divs not `aria-live`. `main.ts:27,34,41`.

**Widget** (`packages/widget`)
- **4.11** (see 0.3) no close button / no Esc.
- **4.12** Failed send discards typed message (`input.value=""` before fetch). `chat/main.ts:81`.
- **4.13** Unavailable state is a dead end (composer hidden, no retry). `chat.html:114`, `main.ts:72-75`.
- **4.14** Suggested prompts hardcoded e-commerce for every tenant. `chat/main.ts:8-12`.
- **4.15** Bot links not clickable + no `overflow-wrap` → long URLs overflow bubble. `chat/main.ts:23`, `chat.html:118`.
- **4.16** No `aria-live` on `#log`; typing indicator outside live region. `chat/main.ts:24,29-38`.
- **4.17** Tenant `branding.color` applied with no contrast validation → unreadable header/bubbles. `chat/main.ts:63`.

**Marketing** (`packages/marketing`)
- **4.18** Every CTA → `/app`; "See how it works" goes to login (broken promise). `index.html:245-246,271-272`.
- **4.19** Live dogfooded widget undiscoverable (no pointer from hero). `src/main.ts:20-27`.
- **4.20** No responsive nav (no stack/hamburger at phone widths). `index.html:49-54`.

**Cross-cutting UI**
- **4.21** `#6D5AE6` on white fails WCAG AA for text; darker `--color-accent-700 #4f3ec0` exists but unused for links/ghost labels.
- **4.22** Brand name inconsistent: "AI Chatbot" / "Chatbot Platform" / "Chatbot Portal".
- **4.23** Two different message-bubble designs + `bot` vs `assistant` class-name mismatch between widget and transcript.

---

## Confirmed strengths (do NOT regress)

CORS reflects only validated origins · site keys stored hashed (`sha256`) · `tenantId` always server-derived from verified claims · no secret leakage (only ARN in templates, nothing logged) · `alg:"none"` rejected + DER→JOSE integer padding correct · postMessage origin/source checks on both ends · widget < 30KB gz (real CI budget gate) · Shadow DOM style isolation · `prefers-reduced-motion` respected everywhere · chat renders model output with `textContent` (XSS-safe) · strict TS config (`noUncheckedIndexedAccess` etc.) · zod `safeParse` on responses.

---

## Decisions already made by the user (carried into design)

- **Portal → React + MUI** (Material Design), with **react-hook-form + zod** reusing `packages/shared` schemas; **DataGrid** for sessions; **Snackbar** for save feedback; **Stepper** for signup→verify→login.
- **Widget stays vanilla** (protect the 30KB budget) — its UX bugs fixed in place.
- **Marketing stays static HTML** — fix broken CTAs + nav responsiveness only.
- Preserve Playwright `data-testid` hooks and `VITE_E2E` behavior through any rewrite so CI stays green.
