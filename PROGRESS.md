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

## Gate checklist (each phase)
tests green → reviewer subagent pass → conventional commit → PROGRESS update.

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
