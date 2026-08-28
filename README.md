# Multi-Tenant AI Chatbot Platform

An embeddable AI chat widget with a self-serve tenant portal, on AWS. pnpm
monorepo · TypeScript · CDK · Node 22 Lambdas · DynamoDB single-table · HTTP
API Gateway · CloudFront/S3 · Cognito · KMS-signed widget JWTs · provider-
agnostic model adapter (Claude Haiku primary).

## Packages

| Package | What it is |
|---|---|
| `packages/shared` | zod contracts + DDB key helpers (imported by widget, portal, backend) |
| `packages/widget` | IIFE loader (`widget.js`) + iframe chat app (`chat.*`) |
| `packages/backend` | Lambda handlers: health, session, chat, admin, post-confirmation |
| `packages/marketing` | static homepage (`www.*`), dogfoods its own widget |
| `packages/dashboard` | tenant portal SPA (`app.*`) |
| `infra` | CDK app: Data, Api, Edge, Observability stacks |
| `e2e` | Playwright: widget handshake + money-path |

## Prerequisites

- Node 22, pnpm 9.15 (`corepack prepare pnpm@9.15.0 --activate`)
- A Route 53 **hosted zone** for your domain in each AWS account (CDK imports it)
- CDK bootstrapped in each account/region (`cdk bootstrap`)

## Local dev

```bash
corepack prepare pnpm@9.15.0 --activate
pnpm install
cp .env.example .env          # set DOMAIN_NAME, MODEL_API_KEY (local only)

pnpm --filter @platform/widget dev     # widget/chat dev server
pnpm --filter @platform/dashboard dev  # portal (needs VITE_* below)
pnpm ci:local                          # lint + typecheck + tests + build + synth
```

Portal/marketing read Vite env at build time:
`VITE_API_BASE`, `VITE_CDN_ORIGIN`, `VITE_CHAT_ORIGIN`, `VITE_DEMO_SITE_KEY`
(marketing) and `VITE_USER_POOL_ID`, `VITE_USER_POOL_CLIENT_ID` (portal).

Seed a dev tenant + dummy catalog (needs AWS creds + a deployed table):

```bash
TABLE_NAME=platform-dev pnpm --filter @platform/backend seed
```

## GitHub configuration

Set these under **Settings → Secrets and variables → Actions**.

### Variables (`vars.*`)

| Name | Purpose |
|---|---|
| `DOMAIN_NAME` | Root domain; CDK derives `cdn.`, `api-{env}.`, `chat.`, `app.`, `www.` |
| `HOSTED_ZONE_ID_DEV` | Route 53 zone id for dev (lets CI `cdk synth` skip a live lookup) |

### Secrets (`secrets.*`)

| Name | Purpose |
|---|---|
| `AWS_DEPLOY_ROLE_DEV` | OIDC role ARN assumed by `deploy-dev` |
| `AWS_DEPLOY_ROLE_STAGING` | OIDC role ARN for staging |
| `AWS_DEPLOY_ROLE_PROD` | OIDC role ARN for prod |

No AWS access keys anywhere — CI authenticates via GitHub OIDC only. The model
API key is **not** a GitHub secret; it lives in Secrets Manager at
`platform-{env}/model-api-key` (create it once per account, see below).

## Deploy flow

```
PR              → ci.yml: lint, typecheck, vitest, isolation suite,
                  cdk synth, widget size (<=30KB gz), Playwright E2E
push to main    → deploy-dev.yml (OIDC → cdk deploy --all to dev)
tag v*          → deploy-staging.yml
release / manual→ deploy-prod.yml (behind the `prod` GitHub environment)
```

Each deploy assumes the env's OIDC role and passes `DOMAIN_NAME` to CDK. Prod
is gated by a required-reviewer rule on the `prod` GitHub environment.

### Static assets

`cdk deploy` provisions the S3 buckets + CloudFront distributions but does not
upload site assets. After a deploy, build and sync each bundle to its bucket
(names are CloudFormation outputs of the `Platform-{env}-Edge` stack):

```bash
pnpm --filter @platform/widget build
aws s3 sync packages/widget/dist       "s3://$WIDGET_BUCKET"
aws s3 sync packages/widget/dist-chat  "s3://$CHAT_BUCKET"
aws s3 sync packages/marketing/dist    "s3://$MARKETING_BUCKET"
aws s3 sync packages/dashboard/dist    "s3://$PORTAL_BUCKET"
aws cloudfront create-invalidation --distribution-id <cdn> --paths /widget.js
```

## Architecture notes

- **Single table** `platform-{env}` with `GSI1` for site-key lookup. Tenant
  isolation is app-layer: keys are derived from verified JWT / Cognito claims,
  never client input; `dynamodb:LeadingKeys` bounds each Lambda to `TENANT#`.
- **Widget JWTs** are ES256, signed by KMS (private key never leaves the HSM),
  `exp ≤ 60m`, verified against the KMS public key.
- **Abuse controls**: per-session + per-tenant DDB rate limits, WAF on the API
  and CDN, a per-tenant kill switch honored within 60s, structured logs, and
  CloudWatch alarms → SNS.

See `PROGRESS.md` for phase-by-phase status and open TODOs.
