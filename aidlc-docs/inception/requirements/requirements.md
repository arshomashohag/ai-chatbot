# Requirements — Review Findings Remediation

## Intent Analysis
- **User request**: "use aidlc to fix all the issues found in these two review loop. First document the review result in a doc and then fix those."
- **Request type**: Bug Fix + Refactoring + Enhancement (remediation of a cross-cutting findings inventory)
- **Scope estimate**: System-wide (backend, infra, all 3 UIs, tests)
- **Complexity estimate**: Complex
- **Requirements depth**: Comprehensive
- **Source of work**: `aidlc-docs/inception/reverse-engineering/review-findings.md` (43 findings, Tiers 0–4)

## Scope (confirmed with user)
**In scope**: Tier 0 (live bugs) + Tier 1 (critical security/cost-safety) + Tier 2 (high-severity structural) + all Tier 4 UI/UX. **Deferred**: Tier 3 (medium backend/infra scale/ops) to a later run — *except* the small Tier-3 items that are cheap and directly enable an in-scope fix (called out per-unit below).

**Commercial-safety scope**: Enforcement only — read `USAGE#` counters, enforce a per-tenant monthly quota with automatic kill-switch on breach. **No** Stripe/billing/plans UI this run.

**UI stack**: Portal → **React + MUI** (react-hook-form + zod reusing `packages/shared` schemas; MUI Stepper for auth, DataGrid for sessions, Snackbar for feedback). **Widget stays vanilla** (protect 30KB budget). **Marketing stays static HTML** (fix CTAs + responsive nav only). Preserve Playwright `data-testid` hooks and `VITE_E2E` behavior through the rewrite.

## Functional Requirements

### FR-1 — Chat correctness (Tier 0)
- FR-1.1 Chat history MUST be retrieved most-recent-first (fix `queryHistory` ordering) and returned to the model in chronological order. *(0.1)*
- FR-1.2 Message persistence MUST be collision-free (globally unique, ordered sort keys) and MUST NOT lose data on same-millisecond sends. *(0.2)*
- FR-1.3 Message persistence MUST handle >25 items (chunk BatchWrite) and retry `UnprocessedItems`; a persist failure MUST NOT discard an already-generated reply. *(0.2, 2.7)*
- FR-1.4 Tenant provisioning (post-confirmation) MUST be idempotent under partial failure — a user MUST never point at a nonexistent tenant. *(0.4)*

### FR-2 — Widget UX (Tier 0 + Tier 4)
- FR-2.1 The widget MUST be closable on all viewports: a persistent header close control + Esc-to-close, with focus returned to the launcher. *(0.3, 4.11)*
- FR-2.2 A failed send MUST preserve the user's typed message and offer retry. *(4.12)*
- FR-2.3 The "unavailable" state MUST offer a retry path, not dead-end. *(4.13)*
- FR-2.4 Suggested prompts MUST derive from tenant config (FAQ titles), not hardcoded e-commerce. *(4.14)*
- FR-2.5 Bot replies MUST render URLs as safe clickable links and wrap long tokens. *(4.15)*
- FR-2.6 The chat log MUST be an `aria-live` region; typing indicator announced. *(4.16)*
- FR-2.7 Tenant brand color MUST be contrast-validated before applying. *(4.17)*

### FR-3 — Portal rebuild (Tier 2 + Tier 4)
- FR-3.1 Auth MUST be a single stepped flow (login ⇄ create-account → verify → done), email carried signup→verify, with resend-code and forgot-password. *(2.8, 4.1)*
- FR-3.2 All forms MUST validate client-side (types, required, format via zod) before POST; submit disabled until valid; inline per-field errors. *(2.9)*
- FR-3.3 Backend errors (incl. Cognito) MUST be mapped to human copy — never raw exception strings. *(4.3)*
- FR-3.4 Saves MUST surface both success and error feedback (Snackbar); no silent failures. *(2.8)*
- FR-3.5 The embed snippet MUST have a copy button and reassurance copy; not a one-shot. *(4.6)*
- FR-3.6 Appearance color MUST use a color picker defaulting to brand `#6d5ae6`; tone select MUST reflect saved value. *(2.8, 4.7, 4.8)*
- FR-3.7 Empty states + onboarding progress + logged-in identity MUST be present. *(4.4, 4.5)*
- FR-3.8 Sessions MUST render in a DataGrid with timestamps/sort; transcript labeled. *(4.4, 3.10 enabling)*
- FR-3.9 Allowed-domains MUST support multiple entries with explanatory copy. *(4.9)*
- FR-3.10 Auth inputs MUST carry correct `autocomplete`/`inputmode`; errors `aria-live`. *(4.10)*

### FR-4 — Security (Tier 1 + Tier 2)
- FR-4.1 Widget bearer token MUST be Origin-bound: chat handler MUST enforce request Origin == `claims.origin`. *(1.2)*
- FR-4.2 Portal MUST NOT be vulnerable to stored XSS (escape/component-render all tenant config). *(1.3)*
- FR-4.3 JWT verification MUST key the public-key cache by `keyId` (TTL'd), and tokens MUST carry + enforce `kid`; add `iss`/`aud`. *(1.4)*
- FR-4.4 A strict CSP MUST be served on all surfaces; chat surface uses `frame-ancestors` instead of blanket `X-Frame-Options: DENY`. *(1.5)*
- FR-4.5 CORS headers MUST be present on error responses; preflight handled. *(2.6)*
- FR-4.6 IAM `LeadingKeys` MUST be treated as documentation; add an app-layer central data-access guard asserting every PK == caller's tenant. *(2.1)*
- FR-4.7 `apiBase` MUST NOT be taken untrusted from the URL in a way that can redirect the bearer token. *(3.22 — pulled in as it's a token-exfil vector)*

### FR-5 — Cost safety (Tier 1)
- FR-5.1 The chat handler MUST enforce a per-tenant monthly quota read from `USAGE#`, returning a tenant-configurable over-quota message. *(1.1)*
- FR-5.2 Breaching the quota (or a spend ceiling) MUST automatically trip the kill-switch. *(1.1)*

### FR-6 — Deploy safety (Tier 2)
- FR-6.1 Asset deploy MUST NOT serve broken/half-synced assets: split cache policy (immutable hashed assets vs no-cache HTML), upload-before-delete ordering, invalidate. *(2.2)*
- FR-6.2 OIDC dev/staging trust MUST be environment-scoped (not bare `refs/heads/main`); widget bundle SHOULD carry SRI. *(2.3)*
- FR-6.3 Deploy MUST run a post-deploy smoke test (`/health` + money-path) and MUST NOT let a red build reach prod; version-redeploy rollback documented. *(2.5)*

### FR-7 — Test coverage (Tier 2)
- FR-7.1 The chat handler MUST have unit tests: 401 / 503 (killswitch) / 429 / 200-degrade / happy-path with persistence + usage assertions. *(2.4)*
- FR-7.2 JWT, rate-limiter, site-key/grace-key rotation, and post-confirmation idempotency MUST gain the missing tests, including PBT where applicable. *(3.27–3.30, PBT)*

## Non-Functional Requirements
- **NFR-Security**: Security baseline (SECURITY-01…15) enforced as blocking. Key rules in play: SECURITY-04 (CSP/headers), 05 (input validation), 08 (authz, IDOR, CORS, token validation), 12 (auth/session/brute-force), 13 (SRI, pipeline integrity), 15 (fail-closed, global error handling).
- **NFR-Resiliency** (directional, per opt-in): RESILIENCY-10 (timeouts on all external calls, graceful degradation) applied to the chat/model path; RESILIENCY-06 (health checks) already present, extended by smoke test. DR = **single-region multi-AZ** (RESILIENCY-02/08 answer: E/A). Deploy = **direct + version-redeploy rollback** (RESILIENCY-04). Change mgmt + incident response = **lightweight, AI-proposed** (RESILIENCY-03/15). Deep DR/multi-region deferred (out of scope) — documented as accepted.
- **NFR-Testing**: Vitest + Playwright retained. PBT via **fast-check** (Vitest-integrated), **Partial** mode (PBT-02/03/07/08/09 blocking): round-trip (DER↔JOSE, zod serialize), invariants (rate-limiter cap, key ordering), domain generators, seed logging, framework in deps.
- **NFR-Performance**: Widget MUST remain < 30KB gz (unchanged budget). Portal is a separate bundle (React+MUI) — no shared budget with the widget.
- **NFR-Accessibility**: WCAG AA contrast (switch text/links to `--color-accent-700`); focus-visible on all interactive controls; `aria-live` regions.
- **NFR-Compatibility**: Preserve all Playwright `data-testid` selectors and `VITE_E2E` bypass semantics so the E2E suite stays green through the portal rewrite.

## Out of Scope (this run)
Tier 3 items unless they cheaply enable an in-scope fix: hot-partition sharding (3.1), product search index (3.2), most pagination (3.3), GSI projection change (3.5), message TTL (3.6), adapter factory/retry beyond timeouts (3.7), grace-key early-revoke (3.11), DDB backups/deletion-protection (3.15), access logs/X-Ray (3.16), reserved concurrency/DLQ (3.17), budget alarms (3.18), cert-region assert (3.19), SPA 404 handling (3.20), debug-OIDC removal (3.21 — trivial, may include), widget teardown (3.24), full billing/Stripe, GDPR deletion (2.11). These remain documented in the findings doc for a follow-up run.

## Key Requirements Summary
Fix the four live bugs; close the runaway-spend hole with quota enforcement; bind and harden the widget JWT + add CSP + kill the portal XSS; make deploys safe (cache split, env-scoped OIDC, smoke gate); rebuild the portal in React+MUI with real validation and error handling; and backfill the highest-value missing tests. Security baseline blocking; resiliency directional (single-region); PBT partial.
