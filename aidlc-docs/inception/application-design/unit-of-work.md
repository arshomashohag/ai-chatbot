# Units of Work

9 units, each an independently-committable gate on the `fix/review-findings` branch. Order is by dependency + severity. Every in-scope finding maps to exactly one unit (see `unit-of-work-story-map.md`).

Cheap Tier-3 enablers included per decision Q4=A: `messageCount` write (3.10), `JSON.parse` guards (3.9), debug-OIDC guard (3.21).

---

## U1 — Chat data-layer correctness
**Package(s)**: `packages/shared` (keys), `packages/backend`
**Findings**: 0.1, 0.2, 0.4, 3.10 (enabler)
**Responsibilities**:
- Fix `queryHistory` to fetch most-recent-first (`ScanIndexForward: false`, `Limit`) and return chronological order (0.1).
- Replace per-turn `MSG#<iso>#<idx>` sort key with a globally-unique, monotonic ULID-based key so same-millisecond sends can't collide/overwrite (0.2).
- Chunk `persistMessages` into ≤25-item BatchWrite batches and retry `UnprocessedItems` with backoff (0.2).
- Make `ensureUserTenant` idempotent: always attempt the tenant-CONFIG put with `attribute_not_exists`, independent of the profile check, so a partial failure never orphans a user (0.4). Prefer `TransactWriteItems` if clean.
- Increment a `messageCount` on the SESSION item during persist so the portal sessions view is truthful (3.10).
**Design stages**: Functional Design (data-model change: sort-key scheme, idempotency). NFR Requirements/Design light. PBT applies (key ordering invariant, ULID monotonicity).
**Definition of Done**: unit tests for history ordering, same-ms non-collision, >25-item persist, idempotent re-entry; existing suites green.

## U2 — Widget JWT hardening + Origin binding
**Package(s)**: `packages/shared` (jwt contract), `packages/backend`, `packages/widget`
**Findings**: 1.2, 1.4, 4.7
**Responsibilities**:
- Key the KMS public-key cache by `keyId` with a TTL; emit `kid` in the JWT header and enforce it; add + enforce `iss`/`aud` in `WidgetClaims` (1.4).
- Chat handler enforces request `Origin` == `claims.origin`; reject on mismatch (1.2).
- Stop trusting `apiBase` from an untrusted URL param in a way that can redirect the bearer token; bind it to the verified session/config (4.7).
**Design stages**: Functional Design (token contract), NFR Design (SECURITY-08 token validation, key rotation). PBT: DER↔JOSE round-trip (already partially present — extend).
**DoD**: tests for kid mismatch, iss/aud enforcement, origin mismatch rejection, cross-key rejection.

## U3 — Cost-safety: quota enforcement + auto kill-switch
**Package(s)**: `packages/backend`
**Findings**: 1.1 (FR-5)
**Responsibilities**:
- Read `USAGE#<month>` in the chat path (via config cache) and enforce a per-tenant monthly quota before the model call; return a tenant-configurable over-quota message (1.1).
- On quota/spend breach, automatically set the tenant kill-switch (1.1).
- Quota value sourced from tenant config with a safe platform default.
**Design stages**: Functional Design (quota check placement, precedence vs rate-limit/killswitch), NFR Design (SECURITY-11 abuse, RESILIENCY graceful degrade).
**DoD**: tests for under-quota pass, at-quota block, auto-killswitch trip, message configurability.

## U4 — Backend robustness
**Package(s)**: `packages/backend`
**Findings**: 2.6, 2.7 (rate-limit/usage hot-path), 3.8, 3.9, 3.13
**Responsibilities**:
- CORS headers on all error responses (reflecting only validated origin) + preflight handling (2.6).
- Rate-limit/usage on the hot path: explicit fail-open/closed policy on DDB error, moved off the served-reply path so a persist/usage blip can't 500 a good reply (2.7).
- Kill-switch/suspend read path: shorten/bust cache or read consistently so kill takes effect fast (3.8).
- Guard `JSON.parse` in chat/admin → clean 400 (3.9).
- Rate-limiter TTL computed as explicit epoch-seconds, not window-index (3.13).
**Design stages**: NFR Design (SECURITY-15 fail-closed + global error handling, RESILIENCY-10 timeouts/degradation).
**DoD**: tests for CORS-on-4xx, degrade-not-500 on usage failure, malformed-body 400, kill-switch latency.

## U5 — Widget UX (vanilla)
**Package(s)**: `packages/widget`
**Findings**: 0.3, 4.11, 4.12, 4.13, 4.14, 4.15, 4.16, 4.17
**Responsibilities**:
- Persistent header close (X) + Esc-to-close (postMessage to parent), launcher icon toggles, focus returns to launcher — mobile no longer traps (0.3, 4.11).
- Preserve typed message on failed send + retry (4.12); unavailable state offers retry (4.13).
- Suggested prompts from tenant config/FAQ titles (4.14).
- Safe clickable links + `overflow-wrap` in bubbles (4.15).
- `aria-live` on `#log`, typing indicator announced (4.16).
- Contrast-validate tenant brand color before applying `--wa` (4.17).
**Constraint**: MUST stay < 30KB gz.
**Design stages**: minimal (UI-only, in-boundary). NFR: accessibility.
**DoD**: E2E still green; widget size budget green; manual a11y checks documented.

## U6 — Portal rebuild → React + MUI
**Package(s)**: `packages/dashboard` (rewrite), consumes `packages/shared` schemas
**Findings**: 1.3, 2.8, 2.9, 4.1–4.10, 4.21, 4.22, 4.23
**Responsibilities**:
- Migrate portal to React + MUI + Vite; MUI theme mapped from design tokens (brand `#6d5ae6`, Plus Jakarta Sans).
- Auth as MUI Stepper: login ⇄ create-account → verify (email carried, code focused) → done; resend-code + forgot-password (4.1).
- react-hook-form + `@hookform/resolvers/zod` reusing `packages/shared` schemas; submit disabled until valid; inline errors (2.9); humanized backend/Cognito errors (4.3).
- Eliminate stored XSS (component rendering, no `innerHTML` interpolation) (1.3).
- Snackbar save success+error (2.8, 4.4); embed-snippet copy button (4.6); MUI color picker default `#6d5ae6` (4.7); tone Select reflects saved value (4.8); multi-domain allowlist (4.9); empty states + onboarding + logged-in identity (4.4, 4.5); DataGrid sessions with timestamps (3.8-adjacent/4.4); autocomplete/inputmode/aria-live (4.10); WCAG AA link color (4.21).
- Preserve all Playwright `data-testid` + `VITE_E2E` bypass semantics.
**Design stages**: Functional Design (component tree, form/validation model, auth state machine), NFR Requirements (React+MUI+fast-check+react-hook-form recorded), NFR Design (SECURITY-08/12 auth, SECURITY-05 validation, a11y).
**DoD**: portal E2E green (money-path), no `innerHTML` sinks, validation blocks bad input pre-POST, build succeeds.

## U7 — Marketing + shared CSP/headers + design-system import
**Package(s)**: `packages/marketing`, `packages/shared` (tokens usage), `infra` (edge headers)
**Findings**: 1.5, 2.10, 4.18, 4.19, 4.20, 4.21, 4.22, 4.23
**Responsibilities**:
- Strict CSP on all served surfaces via CDK `ResponseHeadersPolicy`; chat surface uses `frame-ancestors` instead of blanket `X-Frame-Options: DENY` (1.5, SECURITY-04).
- Import `tokens.css` (or its component classes) so the design system is actually used, not copy-pasted; unify button/input/bubble styles + `bot`/`assistant` naming; WCAG AA link/ghost color (2.10, 4.21, 4.23).
- Marketing: distinct CTAs (login vs signup vs a real "see how it works" demo anchor), discoverable live-demo pointer, responsive nav (4.18–4.20).
- Unify brand name across UIs (4.22).
**Design stages**: NFR Design (SECURITY-04 CSP). Infra touch (headers).
**DoD**: CSP present + validated (no unjustified unsafe-inline), marketing CTAs correct, nav responsive, synth clean.

## U8 — Deploy pipeline safety
**Package(s)**: `infra`, `.github/workflows`
**Findings**: 2.2, 2.3, 2.5, 3.21 (enabler)
**Responsibilities**:
- Split cache behaviors: immutable long-TTL for hashed assets, `no-cache` for HTML; upload-new-before-delete ordering; invalidate after (2.2).
- OIDC dev/staging trust scoped to GitHub environments (not bare `refs/heads/main`); add SRI to the widget embed where feasible (2.3, SECURITY-13).
- Post-deploy smoke gate (`/health` + money-path against deployed URL); ensure deploy is gated on CI; document version-redeploy rollback + lightweight change-record + incident-response (2.5, RESILIENCY-04/15).
- Guard/remove the permanent debug-OIDC step (3.21).
**Design stages**: Infrastructure Design (cache policy, OIDC trust, smoke gate).
**DoD**: synth clean; workflow YAML valid; documented rollback + smoke steps.

## U9 — Test backfill + PBT + tenant-access guard
**Package(s)**: `packages/backend`, `packages/shared`, `infra` tests, `e2e`
**Findings**: 2.1, 2.4, 3.27, 3.28, 3.29, 3.30, 3.31
**Responsibilities**:
- Central tenant-access guard asserting every DDB PK == caller's tenant; full negative cross-tenant assertions (2.1, SECURITY-08).
- `handlers/chat.test.ts`: 401/503/429/200-degrade/happy-path with persistence+usage (2.4).
- JWT algorithm-confusion/cross-key/DER-padding tests + PBT round-trip (3.27); rate-limiter cap-boundary/TTL/window PBT (3.28); site-key/grace-key rotation (3.29); post-confirmation idempotency (3.30); CDK authorizer-coverage/WAF/KMS-spec template assertions (3.31).
- PBT via fast-check (Partial mode: PBT-02/03/07/08/09).
**Design stages**: NFR Requirements (fast-check framework), Build-and-Test alignment.
**DoD**: all new tests green in CI; coverage of the cited paths; E2E green.

---

## Code organization
No new packages or directory restructuring — all units modify existing packages in place. The only structural change is `packages/dashboard` internals migrating to a React+MUI source tree (still one package, same build output contract to the Edge stack). Application code stays at workspace root; only docs live in `aidlc-docs/`.
