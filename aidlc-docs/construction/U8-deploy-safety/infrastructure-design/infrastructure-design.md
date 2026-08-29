# U8 — Infrastructure Design: Deploy pipeline safety

**Unit**: U8 · **Findings**: 2.2, 2.3, 2.5, 3.21
**Requirements**: FR-6.1, FR-6.2, FR-6.3 · **Extensions**: SECURITY-13 (CI/CD integrity, SRI), RESILIENCY-04 (rollback), RESILIENCY-15 (incident response).
**Resiliency decisions (from Requirements)**: single-region multi-AZ; **direct deploy + version-redeploy rollback**; lightweight AI-proposed change/incident process.

## Problems (verified)
- **2.2** `deploy.yml` sync step runs four `aws s3 sync ... --delete` — deleting old hashed assets in the **same pass** it uploads new ones. During the multi-second window a client can request a chunk that's already deleted but whose replacement isn't up yet → chunk-load errors. Also all distributions use `CACHING_OPTIMIZED` with no split between long-lived hashed assets and must-revalidate HTML.
- **2.3** OIDC trust (`github-deploy-role.yaml`): dev/staging = `ref:refs/heads/main` (any workflow on main can assume the role), prod = `environment:prod`. Widget embed has no SRI/crossorigin.
- **2.5** No post-deploy smoke test; no rollback runbook; prod isn't required to follow staging.
- **3.21** The "Debug OIDC token claims" step runs on every deploy incl. prod — clutter on the critical path.

## Design

### D1 — cache-safe asset sync (2.2)
Rework the deploy sync into the safe ordering, per surface:
1. **Upload new files first, no `--delete`** (`aws s3 sync <dist> s3://<bucket>`), so every asset the new HTML references exists before any HTML changes.
2. **Then** invalidate (HTML + `/*`).
3. **Then** a **second pass with `--delete`** to prune assets no longer present — after invalidation, so in-flight clients on the old HTML already got their chunks.
- For SPAs (marketing/portal) Vite emits hashed `/assets/*` + a mutable `index.html`. Uploading assets-before-HTML within one `sync` isn't ordered, so the two-pass (add-then-prune) approach is what guarantees no missing chunk.
- **Split cache policy** in `edge-stack.ts`: a `CachePolicy` (or response-headers `Cache-Control`) so `/assets/*` (immutable, content-hashed) get long max-age + `immutable`, while `index.html`/`widget.js`/`chat.html` get `no-cache` (revalidate). Simplest robust approach with CloudFront + S3: set `Cache-Control` at upload time via `aws s3 sync ... --cache-control` per file-type pass (hashed assets `max-age=31536000,immutable`; HTML `no-cache`), OR add an additional cache behavior for `/assets/*`. Chosen: **set Cache-Control on upload** (two syncs per SPA: assets with immutable, then HTML with no-cache) — keeps it in the pipeline, no distribution behavior change needed, and pairs naturally with the add-then-prune ordering.

### D2 — OIDC environment scoping (2.3)
- Change the dev/staging trust `sub` from `ref:refs/heads/main` to `environment:<env>` (`environment:dev` / `environment:staging`), matching prod. Combined with the existing `environment: ${{ inputs.env }}` on the deploy job, this means the role can only be assumed by a run that has entered the corresponding GitHub Environment (which can carry required reviewers/branch rules) — cryptographically enforced at the trust boundary, not just advisory.
- Implementation: `github-deploy-role.yaml` — the non-prod default subject becomes `repo:${org}/${repo}:environment:${EnvName}`. (The `SubjectClaim` override param stays for edge cases.)
- **SRI (2.3 sub-point)**: full SRI on the mutable `/widget.js` isn't feasible without versioned filenames (the hash changes every deploy; the snippet is generated server-side at key-issue time, decoupled from the widget build). Documented as **deferred** (needs versioned widget artifacts — a Tier-3-adjacent change). Partial hardening now: add `crossorigin="anonymous"` to the embed snippet so a future SRI hash can be added without a snippet format change, and note the plan. (No false sense of SRI — we don't emit an integrity attr we can't compute.)

### D3 — post-deploy smoke gate + rollback (2.5)
- Add a **Smoke test** step after the sync/invalidate: hit `https://<api>/health` (the health route exists) and assert 200 + expected body; optionally curl the marketing/portal index for 200. On failure the job fails (red), signalling a bad deploy.
  - The API origin comes from the Api stack output (env-independent).
- **Rollback**: version-redeploy — documented in README/PROGRESS: to roll back, re-run the deploy workflow from the previous good commit SHA (CDK re-converges infra; asset sync re-publishes the old build). Add a short runbook.
- **Prod gated on staging**: enforced operationally via the `prod` GitHub Environment's required-reviewer rule (already the trust model) + a documented rule that prod deploys follow a green staging deploy. (A hard needs-chain across separate workflow_dispatch workflows isn't expressible without merging them; the environment protection + runbook is the pragmatic control for this single-repo setup.)

### D4 — guard the debug-OIDC step (3.21)
- Gate the "Debug OIDC token claims" step behind a `debug` input (default false) so it doesn't run on every (incl. prod) deploy. Add an optional `debug` input to the reusable workflow; the step runs only when `inputs.debug == true`. Keeps the tool available for troubleshooting without cluttering the prod critical path.

## Files changed
| File | Change |
|---|---|
| `.github/workflows/deploy.yml` | add-then-prune sync with per-type Cache-Control; smoke-test step; `debug` input gating the OIDC-debug step |
| `.github/workflows/deploy-{dev,staging,prod}.yml` | (no change needed; optionally pass `debug: false`) |
| `infra/bootstrap/github-deploy-role.yaml` | dev/staging trust → `environment:<env>` |
| `packages/backend/src/handlers/admin.ts` | snippet gains `crossorigin="anonymous"` |
| `README.md` / `PROGRESS.md` | rollback runbook + smoke-gate note |

## Security / Resiliency compliance
- **SECURITY-13** (CI/CD integrity): OIDC environment-scoped trust (tighter than branch); SRI documented (partial now, versioned-artifact plan). ✅ (SRI partial, justified)
- **RESILIENCY-04** (rollback): version-redeploy rollback documented; direct deploy style (per Requirements decision). ✅
- **RESILIENCY-15** (incident response): smoke gate surfaces a bad deploy immediately; lightweight rollback runbook. ✅
- **RESILIENCY-06** (health checks): the smoke test exercises `/health` post-deploy. ✅

## Definition of Done
- Sync uploads new assets before pruning old (no `--delete` in the add pass); hashed assets get immutable Cache-Control, HTML gets no-cache.
- OIDC dev/staging trust is `environment:<env>`.
- A smoke-test step hits `/health` (and index) and fails the deploy on non-200.
- Debug-OIDC step only runs when `debug: true`.
- Snippet has `crossorigin`; SRI-deferral documented.
- Rollback runbook in README/PROGRESS.
- `deploy.yml` valid YAML; CFN template valid; synth + tests unaffected.
