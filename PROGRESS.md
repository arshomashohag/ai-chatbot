# Implementation Progress

Multi-tenant AI chatbot platform. Phases per `docs/chatbot-platform-implementation-plan.md`.

## Status

| Phase | Description | State |
|---|---|---|
| P0 | Monorepo scaffold + CI/CD | ✅ complete |
| P1 | Widget + session auth | ✅ complete |
| P2 | Chat pipeline + model + one tool | ✅ complete |
| P3 | Abuse protection | ⬜ not started |
| P4 | Marketing site + tenant portal v1 | ⬜ not started |

## Gate checklist (each phase)
tests green → reviewer subagent pass → conventional commit → PROGRESS update.

## Open WARNs / TODOs
- [ops] `dynamodb:LeadingKeys: TENANT#*` bounds session+chat Lambdas to tenant partitions but is NOT per-tenant isolation — enforced in app code (JWT/site-key derive tenantId server-side; message PK embeds tenantId). Per-tenant IAM needs request-scoped creds; revisit later. (reviewer P1 #4, P2 #3)
- [P3] `search_products` DDB Query is capped at Limit=200 then filtered in-memory; move to a proper query/index if catalogs grow. (reviewer P2 #5)
- [P4] Loader: require `data-api-base` and validate it's absolute; silent fail-closed if a tenant misconfigures. (reviewer P1 #6)

Resolved in P1: widget now imports `@platform/shared` zod schemas (P0 #2); session Lambda DDB grants scoped with `dynamodb:LeadingKeys` (P0 #3).

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
