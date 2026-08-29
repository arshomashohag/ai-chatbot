# AI-DLC State Tracking

## Project Information
- **Project Type**: Brownfield
- **Start Date**: 2026-08-29T00:00:00Z
- **Current Stage**: INCEPTION - Workflow Planning (awaiting approval)
- **Workflow Goal**: Document the findings from two review loops (8-role panel + focused UI/UX re-review), then remediate them.

## Workspace State
- **Existing Code**: Yes
- **Programming Languages**: TypeScript (pnpm monorepo)
- **Build System**: pnpm workspaces + Vite + AWS CDK
- **Project Structure**: Monorepo — packages/{shared,widget,backend,marketing,dashboard}, infra (CDK), e2e (Playwright)
- **Reverse Engineering Needed**: Satisfied via the review loops (codebase already deeply analyzed by an 8-role panel). Findings captured as RE artifacts.
- **Workspace Root**: /Users/shohag/Desktop/Development/ai-chatbot

## Code Location Rules
- **Application Code**: Workspace root (NEVER in aidlc-docs/)
- **Documentation**: aidlc-docs/ only

## Extension Configuration
| Extension | Enabled | Mode | Decided At |
|---|---|---|---|
| security/baseline | Yes | All rules blocking | Requirements Analysis |
| resiliency/baseline | Yes | Directional (Tier-3 infra/DR deferred by scope; design-time guidance applied) | Requirements Analysis |
| testing/property-based | Yes | Partial (PBT-02, 03, 07, 08, 09 blocking) | Requirements Analysis |

## Scope Decisions (Requirements Analysis)
- **Tiers in scope**: 0 (live bugs) + 1 (critical security/cost) + 2 (high-severity structural) + all UI (Tier 4). Tier 3 (medium backend/infra scale/ops) DEFERRED to a later run.
- **Spend cap (finding 1.1)**: Enforcement only — read USAGE# counters, enforce per-tenant monthly quota + automatic kill-switch on breach. No Stripe/billing this run.
- **Delivery**: Unit-by-unit, gated (fix → tests + reviewer pass → conventional commit → PROGRESS.md → pause for review).
- **Portal**: React + MUI, whole portal one unit, react-hook-form + zod reusing packages/shared schemas. Widget stays vanilla; marketing stays static HTML.

## Execution Plan Summary
- **Total units of work**: 9 (U1–U9), each a gated commit. See `aidlc-docs/inception/plans/execution-plan.md`.
- **Stages to execute**: Workflow Planning, Units Generation, per-unit Functional/NFR/Infra Design (conditional), Code Generation, Build and Test.
- **Stages skipped**: User Stories (remediation, not new-feature discovery), Application Design (no new services; portal re-implemented in-boundary).

## Stage Progress
### 🔵 INCEPTION PHASE
- [x] Workspace Detection — brownfield confirmed, state + audit created
- [x] Reverse Engineering — review findings captured (`review-findings.md`)
- [x] Requirements Analysis — requirements.md + extension config recorded
- [x] User Stories — SKIP
- [x] Workflow Planning — execution-plan.md created (awaiting approval)
- [x] Application Design — SKIP
- [x] Units Generation — COMPLETE (9 units defined; awaiting approval to enter Construction)

### 🟢 CONSTRUCTION PHASE
- [ ] Functional Design (per-unit, conditional)
- [ ] NFR Requirements (per-unit)
- [ ] NFR Design (per-unit)
- [ ] Infrastructure Design (deploy unit)
- [ ] Code Generation (per-unit, gated)
- [ ] Build and Test

### 🟡 OPERATIONS PHASE
- [ ] Operations — PLACEHOLDER

## Current Status
- **Lifecycle Phase**: INCEPTION
- **Current Stage**: CONSTRUCTION — U1 (Chat data-layer): code complete, reviewer pass running
- **Next Stage**: U1 commit → U2 (Widget JWT hardening + Origin binding)
- **Status**: In progress
- **Branch**: fix/review-findings

## Construction Progress
- [x] U1 Chat data-layer — FD + code + 61 tests green (+14) + typecheck/lint clean + reviewer pass + committed (148f222)
- [x] U2 Widget JWT hardening + Origin binding — FD + code + 70 tests green (+9) + typecheck/lint/size clean + reviewer pass (no findings) + committed
- [ ] U3 Quota enforcement + auto kill-switch  ← next
- [ ] U4 Backend robustness
- [ ] U5 Widget UX
- [ ] U6 Portal React+MUI
- [ ] U7 Marketing + CSP + design-system
- [ ] U8 Deploy pipeline safety
- [ ] U9 Tests + tenant-access guard

## Findings Inventory (source of work)
See `aidlc-docs/inception/reverse-engineering/review-findings.md` — the consolidated, deduplicated findings from both review loops. This is the master issue list this workflow will remediate.
