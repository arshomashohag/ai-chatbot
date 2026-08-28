# Implementation Progress

Multi-tenant AI chatbot platform. Phases per `docs/chatbot-platform-implementation-plan.md`.

## Status

| Phase | Description | State |
|---|---|---|
| P0 | Monorepo scaffold + CI/CD | ✅ complete |
| P1 | Widget + session auth | ✅ complete |
| P2 | Chat pipeline + model + one tool | ⬜ not started |
| P3 | Abuse protection | ⬜ not started |
| P4 | Marketing site + tenant portal v1 | ⬜ not started |

## Gate checklist (each phase)
tests green → reviewer subagent pass → conventional commit → PROGRESS update.

## Open WARNs / TODOs
- [P2] Write a JWT verifier that rejects any `alg !== ES256` (no `none`/RS/HS confusion) and enforces `exp`. No consumer exists yet in P1. (reviewer P1 #5)
- [ops] `dynamodb:LeadingKeys: TENANT#*` bounds the shared session Lambda to tenant partitions but is NOT per-tenant isolation — that is enforced in app code (site-key GSI lookup derives tenantId server-side). Per-tenant IAM needs request-scoped creds; revisit later. (reviewer P1 #4)
- [P4] Loader: require `data-api-base` and validate it's absolute; silent fail-closed if a tenant misconfigures. (reviewer P1 #6)

Resolved in P1: widget now imports `@platform/shared` zod schemas (P0 #2); session Lambda DDB grants scoped with `dynamodb:LeadingKeys` (P0 #3).

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
