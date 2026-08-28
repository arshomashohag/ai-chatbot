# Multi-Tenant AI Chatbot Platform — Implementation Plan

AWS-hosted, GitHub Actions CI/CD, delivered in progressive phases. Each phase ends with a working, demoable increment and explicit exit criteria.

---

## Guiding decisions (locked before Phase 0)

| Decision | Choice | Rationale |
|---|---|---|
| IaC | **AWS CDK (TypeScript)** | Same language as widget/backend; first-class Lambda/API GW/DDB constructs; diff-able in PRs |
| Repo layout | **Monorepo** (`pnpm` workspaces) | Widget, backend, infra, dashboard share types (tool schemas, API contracts) |
| Backend runtime | **Node.js 22 Lambda** (TypeScript) | Cold-start friendly, shared types with widget |
| Model access | **Hosted API via a gateway abstraction** (LiteLLM-style adapter, OpenAI-compatible interface) | Provider-swappable; self-hosting becomes a config change later |
| Auth for CI → AWS | **GitHub OIDC federation** (no long-lived AWS keys in GitHub secrets) | Standard security practice |
| Environments | `dev` → `staging` → `prod`, separate AWS accounts (or at minimum separate stacks + prefixes) | Blast-radius isolation; prod deploys gated |

### Monorepo structure

```
/
├─ packages/
│  ├─ widget/          # loader + iframe chat UI (Vite, vanilla TS or Preact)
│  ├─ backend/         # Lambda handlers (session, chat, admin)
│  ├─ shared/          # zod schemas: API contracts, tool definitions, JWT claims
│  ├─ marketing/       # public homepage / landing site (static)
│  └─ dashboard/       # tenant admin portal
├─ infra/              # CDK app (stacks per domain: edge, api, data, observability)
├─ .github/workflows/  # ci.yml, deploy-dev.yml, deploy-staging.yml, deploy-prod.yml
└─ package.json
```

---

## Phase 0 — Foundations & CI/CD skeleton (Week 1)

**Goal:** Empty but fully wired pipeline. A one-line change merges to `main` and lands in dev automatically.

### AWS resources
- AWS accounts/organization: `dev`, `staging`, `prod` (or one account, three CDK stage prefixes to start)
- IAM OIDC identity provider for `token.actions.githubusercontent.com`
- Per-env deploy role (`GitHubDeployRole-{env}`) with trust policy scoped to your repo + branch/environment
- CDK bootstrap in each account/region
- Route 53 hosted zone + ACM certs (us-east-1 for CloudFront, regional for API): `cdn.yourdomain.com`, `api.yourdomain.com`, `chat.yourdomain.com` (iframe origin)
- S3 bucket for widget assets (versioned, private, CloudFront OAC access only)

### CI/CD (GitHub Actions)
- **`ci.yml`** — on every PR: install (pnpm cache), lint, typecheck, unit tests, `cdk synth` (catches infra errors pre-merge), widget bundle-size check (fail if loader > 30KB gz)
- **`deploy-dev.yml`** — on push to `main`: run CI jobs → assume OIDC role → `cdk deploy --all` to dev
- **`deploy-staging.yml` / `deploy-prod.yml`** — manual `workflow_dispatch` or on version tag (`v*`); prod uses a GitHub **environment protection rule** (required reviewer)
- Concurrency groups so parallel deploys to one env can't interleave

### Deliverables
- [ ] Monorepo scaffolded, shared lint/tsconfig, pre-commit hooks
- [ ] OIDC federation working: a PR merge deploys a hello-world Lambda + `GET /health` through API Gateway to dev
- [ ] DNS + TLS live on all three subdomains
- [ ] `README` with local dev setup (`pnpm dev` runs widget against dev API)

**Exit criteria:** merge-to-main → green pipeline → `curl https://api-dev.yourdomain.com/health` returns 200, zero manual steps.

---

## Phase 1 — Widget shell + session handshake (Weeks 2–3)

**Goal:** A test HTML page (posing as a merchant site) embeds the script tag, the bubble renders, clicking it opens the iframe, and a validated session token is issued. No AI yet.

### AWS resources
- **CloudFront distribution #1 (CDN):** origin = widget S3 bucket via OAC; behaviors: `widget.js` (stable pointer, TTL 5 min) and `assets/v{hash}/*` (immutable, TTL 1 year); brotli/gzip; security headers via response-headers policy
- **CloudFront distribution #2 or additional behavior:** serves the iframe app at `chat.yourdomain.com` (S3 static site, same OAC pattern)
- **API Gateway (HTTP API)** `api.yourdomain.com`: routes `POST /v1/widget/session`, `GET /v1/widget/config`
- **Lambda:** `session-handler`
- **DynamoDB table `platform-{env}`** (single-table, on-demand billing):
  - `PK=TENANT#<id>, SK=CONFIG` — site-key hash, allowed origins[], plan, status, branding
  - `GSI1: PK=SITEKEY#<hash>` → tenant lookup
  - `PK=TENANT#<id>, SK=SESSION#<sid>` — origin, UA, createdAt, `ttl` (auto-expire)
- **Secrets Manager / KMS:** JWT signing key (asymmetric ES256 via KMS preferred — sign in KMS, verify with public key, key never leaves HSM)
- Seed script: creates a dev tenant with site key + `localhost` / test-page origins

### Implementation notes
- Loader reads `data-site-key`, injects bubble (shadow DOM), lazy-loads iframe on first click
- `POST /v1/widget/session`: resolve site key via GSI → check `Origin` header against tenant allowlist → mint JWT (`tenant_id`, `session_id`, `origin`, `exp` ≤ 60 min) → write session item → return token + branding config
- CORS on API Gateway: reflect only registered origins (Lambda authorizer or per-route CORS config)
- Widget stores token in iframe memory only (not localStorage — see artifact storage rules; also survives-refresh is a nice-to-have, not phase 1)

### CI/CD additions
- Widget build job: content-hashed bundles → `aws s3 sync` versioned path → update stable `widget.js` pointer → targeted CloudFront invalidation (`/widget.js` only)
- Playwright E2E job in CI: loads test page from `localhost`, asserts bubble render + successful session handshake against dev API

### Deliverables
- [ ] `<script src="https://cdn.yourdomain.com/widget.js" data-site-key="...">` renders bubble + opens chat iframe on any page
- [ ] Session endpoint with strict origin validation (wrong origin / bad key / suspended tenant → 403, structured error codes)
- [ ] JWT issuance via KMS signing; token refresh endpoint
- [ ] DDB single-table deployed with GSI; seed tenant script
- [ ] Loader ≤ 30KB gz enforced in CI; Lighthouse impact on test page measured and documented

**Exit criteria:** copy the snippet into a plain HTML file on an allowed origin → working handshake; same snippet on a non-registered origin → clean 403 in console, widget shows "unavailable" state.

---

## Phase 2 — Chat pipeline: messages, model, first tool (Weeks 4–6)

**Goal:** Real conversations. Widget ⇄ backend ⇄ model with one working tool against a dummy product catalog. Everything persisted in DDB.

### AWS resources
- **Lambda:** `chat-handler` (memory 1024MB+, timeout 60s), `tool-executor` (separate function so tool HTTP calls to merchant APIs are isolated and individually timed out)
- **DDB additions:**
  - `PK=SESSION#<sid>, SK=MSG#<iso-ts>#<ulid>` — role, content, toolCalls, tokenCounts{in,out,cached}, latencyMs
  - `PK=TENANT#<id>, SK=USAGE#<yyyy-mm>` — atomic counters (messages, tokens) for billing later
- **Secrets Manager:** model provider API key(s)
- **Dummy catalog:** small products table (`PK=TENANT#<id>, SK=PRODUCT#<pid>`) + seed data, fronted by the `search_products` tool
- CloudWatch log groups with structured JSON logging from day one (tenant_id, session_id, model, token counts on every request)

### Implementation notes
- `POST /v1/chat/message`: verify JWT (public key cached in Lambda) → load tenant config (in-memory cache, 60s TTL) → `Query` session messages → assemble prompt: [static: system prompt + tool defs] + [history] + [new msg] → model call through the **provider adapter interface** (`complete(messages, tools) → {text | toolCalls}`) → tool loop (max 5 iterations, each tool result appended) → persist all messages atomically (BatchWrite) → respond
- Prompt assembly puts static content first for provider prompt-caching
- Model config per tenant (`model: "haiku-4.5"` in tenant CONFIG) — router-ready from day one
- Widget: message list UI, optimistic send, "typing" indicator, error/retry states, markdown rendering (sanitized)

### CI/CD additions
- Integration test job: spins up seeded dev tenant, runs scripted conversation through real dev API (model mocked in CI via adapter fake; nightly workflow runs against the real model on dev and reports cost)
- Contract tests: zod schemas in `packages/shared` validate API request/response in both widget and backend test suites

### Deliverables
- [ ] End-to-end conversation on the test page: "do you have blue t-shirts?" → model calls `search_products` → grounded answer
- [ ] Full conversation + tool traces + token counts persisted in DDB
- [ ] Provider adapter with two implementations (primary + one fallback provider) switchable per-tenant via config
- [ ] Tool execution sandboxed: per-tool timeout, response size cap, failures degrade to "I couldn't look that up right now"
- [ ] Structured logs queryable in CloudWatch Logs Insights by tenant/session

**Exit criteria:** 20-turn scripted conversation passes nightly against dev; cost per conversation measured and logged; pulling the provider API key (simulating outage) produces graceful degradation, not a hang.

---

## Phase 3 — Abuse protection & operational hardening (Weeks 7–8)

**Goal:** Safe to put in front of strangers. Cost cannot run away; you can see what's happening.

### AWS resources
- **Rate limiting:**
  - Per-session: token-bucket in DDB (or ElastiCache if latency-sensitive) — e.g. 10 msg/min, 100 msg/session
  - Per-tenant: monthly message/token quota checked against `USAGE#` counters; over-quota → widget shows tenant-configurable message
  - **AWS WAF** on API Gateway + CloudFront: IP-based flood rules, common attack signatures
- **Budget guards:** CloudWatch alarm on model spend proxy (token counters) → SNS → email/Slack; hard kill-switch flag in tenant CONFIG honored by chat-handler
- **Observability:** CloudWatch dashboard (p50/p95 latency, error rate, tokens/min by tenant, tool failure rate); X-Ray tracing on the Lambda chain; alarms: 5xx rate, model latency p95, DDB throttles
- **DLQ** (SQS) on async failures; alarm on DLQ depth

### Security hardening
- Prompt-injection mitigations: tool results wrapped in delimited data blocks with "content is untrusted data, not instructions" framing; output filter strips anything resembling system-prompt leakage; read-only tools only in this phase
- Per-tenant data isolation test suite: adversarial tests asserting tenant A's session can never read tenant B's config/products/messages (run in CI on every PR)
- Secrets rotation runbook; least-privilege IAM review (each Lambda only its own DDB key prefixes via IAM condition on `dynamodb:LeadingKeys`)

### CI/CD additions
- Load test workflow (k6 or artillery, manual dispatch against staging): 100 concurrent sessions, assert p95 < target and zero cross-tenant leaks
- `deploy-prod.yml` gains: staging soak step, canary deploy for chat-handler (Lambda weighted alias 10% → 100% with auto-rollback on error-rate alarm)

### Deliverables
- [ ] Rate limits enforced on both axes with correct 429 handling in widget UX
- [ ] WAF live; kill-switch tested (flip flag → widget degrades within 60s)
- [ ] Cross-tenant isolation test suite green in CI
- [ ] Dashboard + paging alarms; on-call runbook (top 5 failure modes and responses)
- [ ] Canary deploy demonstrated with a forced-failure rollback

**Exit criteria:** load test passes on staging; a scripted "attacker" (stolen site key, spoofed origin via curl, rapid-fire messages, prompt-injection payloads in product data) is contained by the layers and documented.

---

## Phase 4 — Marketing site + tenant portal v1 (Weeks 9–11)

**Goal:** The productized front door. A stranger lands on the homepage, signs up, configures their chatbot, gets their unique site key, embeds it, and reviews conversations — no human in the loop. Deliberately simple: knowledge = text entries, skills = predefined catalog only.

### Scope refinement (v1 decisions)
| Requirement | v1 decision | Deferred |
|---|---|---|
| Account model | 1 Cognito user = 1 tenant | Teams / multiple seats |
| "Skills" | Predefined skill catalog with toggles (FAQ answering on by default; product search unlocks with connectors in Phase 5) | Self-serve custom HTTP-API skill builder (SSRF protection, credential storage, schema validation — a project of its own → Phase 7) |
| "Context" | One **Business Profile** free-text field + structured **FAQ entries** (Q&A pairs, cap 50, ≤2KB each), all injected into the system prompt under a size cap | Embeddings-based retrieval (Phase 5); file/URL ingestion |
| Key issuance | Gated on server-side setup-completeness check; plaintext shown **once**, SHA-256 hash stored | — |
| Sessions view | Read-only list + transcript (incl. tool traces) | Search, filters, analytics, CSV export |

### AWS resources
- **Marketing site** at `www.yourdomain.com`: static (S3 + CloudFront), built with Astro/Next static export — hero, features, pricing placeholder, CTA → signup. **Dogfood your own widget on it** (your chatbot answering questions about your chatbot — it's both the demo and your best sales asset). Contact form → SES.
- **Cognito user pool** (email + password, verified email required); post-confirmation Lambda trigger creates the tenant records
- **Portal SPA** at `app.yourdomain.com` (S3 + CloudFront)
- **Admin API routes** (`/v1/admin/*` on the existing HTTP API, Cognito JWT authorizer)
- **DDB additions:**
  - `PK=USER#<cognito-sub>, SK=PROFILE` → `tenant_id` mapping
  - `TENANT# CONFIG` extended: `businessProfile`, widget appearance (name, greeting, color, tone), `setupComplete` flags, enabled skills[]
  - `PK=TENANT#<id>, SK=KB#<ulid>` — knowledge entries (`type: context|faq`, title, body, enabled)
- **SES** for verification + transactional email

### Portal flows
1. **Signup/login** → email verify → empty-state onboarding checklist
2. **Setup wizard:** (a) business basics — name, website URL, allowed domains; (b) chatbot appearance — display name, greeting, brand color, tone preset; (c) knowledge — Business Profile text + FAQ entries
3. **Key issuance:** "Get my key" runs the server-side completeness check (≥1 well-formed domain + business profile + ≥1 knowledge entry) → generates `pk_live_...` → shows plaintext once + copy-paste snippet. Rotation button (24h grace period on the old key). Hash lookup reuses the Phase-1 GSI unchanged.
4. **Sessions viewer:** paginated session list (started, origin, message count) → full transcript incl. tool calls. Strictly tenant-scoped.
5. **Widget honors config:** greeting/branding pulled from CONFIG at session init; enabled knowledge entries assembled into the system prompt (prompt-size cap enforced, oldest-first eviction with a dashboard warning when capped)

### CI/CD additions
- Marketing + portal join the build matrix; Lighthouse budget check on the marketing site
- Playwright E2E (the money path): signup → wizard → key issuance → embed on test page → ask a question answered from the entered FAQ → transcript appears in sessions viewer
- Isolation test suite extended to admin routes (tenant A's Cognito JWT can never read tenant B's config/KB/sessions)

### Deliverables
- [ ] Marketing homepage live with working embedded demo of your own chatbot
- [ ] Self-serve signup, email verification, login
- [ ] Setup wizard with validation; setup-gated key issuance; snippet copy; key rotation with grace period
- [ ] Knowledge v1 (Business Profile + FAQs) demonstrably shaping real answers
- [ ] Sessions viewer (list + transcripts) with admin-route isolation tests green in CI

**Exit criteria:** someone who isn't you completes homepage → signup → setup → key → embed → grounded conversation → transcript visible, unaided, in under 15 minutes; key issuance refuses incomplete setups; cross-tenant admin access blocked by adversarial tests.

---

## Phase 5 — Store connectors + retrieval upgrade (Weeks 12–14)

**Goal:** Real merchant data. The chatbot answers from the store's live catalog, and knowledge scales past the prompt cap.

### AWS resources
- **First real connector — Shopify:**
  - OAuth app flow (Lambda callback handler), encrypted token storage (KMS)
  - `search_products`, `get_product`, `get_order_status` tools mapped to Shopify Admin API; enabling the connector flips the "product search" skill on in the portal catalog
  - Webhook receiver (API GW route + SQS buffer) for catalog change events
- **Knowledge retrieval v2:**
  - Entries (and pasted/uploaded policy pages) → chunk → embed (Bedrock Titan or provider embeddings) → vectors in **S3 Vectors or OpenSearch Serverless** (start with the cheaper S3-based option), tenant-scoped namespaces
  - `search_knowledge` tool replaces prompt-injection of KB entries; FAQ cap lifts

### CI/CD additions
- E2E: connect a Shopify dev store → product question answered from live catalog data
- DB migration discipline: CDK-managed schema changes behind feature flags; backfill scripts (KB → vectors) as versioned one-offs run via workflow_dispatch

### Deliverables
- [ ] Shopify OAuth connect + three live tools against a real dev store
- [ ] "What's your return policy?" answered via retrieval over the merchant's actual text
- [ ] Catalog webhooks keeping product answers fresh
- [ ] Portal skill catalog reflects connector state

**Exit criteria:** a connected dev store gets correct grounded answers for product, order-status, and policy questions; disconnecting the store cleanly degrades those skills.

---

## Phase 6 — Billing, streaming, and polish (Weeks 15–17)

**Goal:** Chargeable product with production-grade UX.

### AWS resources
- **Stripe** integration (checkout + webhooks via API GW → Lambda): plans map to quotas already enforced in Phase 3; usage records pushed from `USAGE#` counters
- **Streaming responses:** Lambda response streaming (function URL) behind CloudFront for token-by-token replies; widget switches from request/response to SSE consumption with graceful fallback
- **Model router v1:** cheap-model default, escalation rules (conversation length, tool-failure retries, sentiment/complexity heuristic) to mid-tier model; per-tenant override
- Handoff hatch: "talk to a human" → email/webhook to merchant with transcript

### Deliverables
- [ ] Paid plans live, quota enforcement tied to subscription state (grace period + dunning states honored by widget)
- [ ] Streaming UX in widget with fallback
- [ ] Router cutting blended cost (measure: cost/conversation before vs after)
- [ ] Human-handoff flow
- [ ] Public status page; SLO definitions (99.9% widget availability target)

**Exit criteria:** first real merchant on a paid plan; unit economics dashboard shows cost/conversation < 10% of per-conversation revenue equivalent.

---

## Phase 7 — Beyond (backlog, sequence by demand)

- WooCommerce + generic "bring your own API" connector builder
- Identity verification (HMAC user hashes) for logged-in customer context (order history, "where is my order?")
- Write-action tools (create return, apply discount) behind per-action merchant approval settings + confirmation UX — revisit prompt-injection posture before enabling
- Multi-language, widget theming API, mobile SDKs
- Fine-tuned small model on accumulated transcripts; evaluate self-hosting when monthly model spend durably exceeds fully-loaded GPU + ops cost
- SOC 2 groundwork: audit logging (CloudTrail org trail, immutable S3), access reviews

---

## Cross-cutting: deployment flow summary

```
PR opened      → ci.yml: lint, typecheck, tests, cdk synth, bundle-size, isolation tests
merge to main  → deploy-dev.yml: full deploy to dev + E2E smoke
tag v*         → deploy-staging.yml: deploy, integration + load smoke
manual approve → deploy-prod.yml: canary (10%) → alarms clean → 100%; auto-rollback on alarm
widget assets  → hashed path upload → flip stable pointer → invalidate /widget.js only
```

**Rollback strategy:** infra via `cdk deploy` of previous tag; widget via repointing `widget.js` to prior hashed bundle (instant, no invalidation wait for versioned assets); Lambda via alias shift back.

---

## Suggested first-90-days milestones

| Week | Milestone |
|---|---|
| 1 | Pipeline green, hello-world in dev |
| 3 | Widget handshake demo on test page |
| 6 | First AI conversation with working product tool |
| 8 | Hardened: rate limits, WAF, isolation tests, canary deploys |
| 11 | Marketing site live + self-serve portal: signup → setup → key → sessions viewer |
| 14 | Shopify connector + retrieval-based knowledge |
| 17 | First paying merchant, streaming UX, model router |
