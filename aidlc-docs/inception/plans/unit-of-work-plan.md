# Unit of Work Plan

**Stage**: INCEPTION — Units Generation (Part 1: Planning)
**Basis**: The 9 units (U1–U9) defined in `execution-plan.md`. This plan formalizes them and resolves the few genuine decomposition choices before generating the unit artifacts.

## Part 1 — Planning checklist
- [x] Confirm decomposition choices (answered: Q1=A, Q2=A, Q3=A, Q4=A)
- [x] Generate `application-design/unit-of-work.md` (unit definitions + responsibilities)
- [x] Generate `application-design/unit-of-work-dependency.md` (dependency matrix)
- [x] Generate `application-design/unit-of-work-story-map.md` (findings→units map, in lieu of stories)
- [x] Validate unit boundaries and dependencies
- [x] Ensure every in-scope finding is assigned to exactly one unit

## Confirmed decisions
- **Q1 = A**: Keep 9 units (U1–U9).
- **Q2 = A**: Portal (U6) = one unit (auth stepper + dashboard together).
- **Q3 = A**: Single feature branch `fix/review-findings`, one commit per unit, PR at end.
- **Q4 = A**: Include cheap Tier-3 enablers — `messageCount` write (3.10), `JSON.parse` guards (3.9), debug-OIDC guard/removal (3.21).

## Decomposition questions

Most of the decomposition is already settled by the execution plan. These are the only real choices left — answer inline or in chat.

### Q1 — Unit granularity / gate frequency
The plan has 9 units. Backend security+correctness (U1–U4) is 4 separate gated commits.

A) **Keep 9 units** as planned — finest-grained review, most gates. (Recommended for the security-sensitive backend work.)

B) **Merge U1–U4 into 2** (one "chat data-layer + robustness", one "JWT + quota security") — fewer gates, larger commits.

C) Merge differently (describe).

[Answer]: 

### Q2 — Portal rewrite as one unit vs. split
U6 rebuilds the whole portal (auth + dashboard) in React+MUI as one unit.

A) **One unit** (auth stepper + full dashboard together) — cohesive, one review. (Recommended.)

B) **Split**: U6a auth stepper first (prove the stack), U6b dashboard — two gates.

[Answer]: 

### Q3 — Branch strategy
Delivery is unit-by-unit gated commits. Currently on `main` (per git status).

A) **One feature branch** `fix/review-findings`, one commit per unit, PR at the end. (Recommended — keeps main clean, matches your CLAUDE.md "branch first" rule.)

B) **Branch per unit** — 9 branches/PRs.

C) Commit straight to `main` (not recommended).

[Answer]: 

### Q4 — Deferred Tier-3 items that are cheap enablers
A few Tier-3 items are trivial and directly support an in-scope fix. Include them opportunistically?

A) **Yes, include the cheap enablers**: `messageCount` write (3.10, enables portal sessions UI), unguarded `JSON.parse` guards (3.9), remove/guard debug-OIDC step (3.21). (Recommended — low cost, high coherence.)

B) **No** — strictly Tiers 0–2 + UI; leave every Tier-3 item for the follow-up run.

[Answer]: 

---

## Recommended defaults
If you just want to proceed: **Q1=A, Q2=A, Q3=A, Q4=A** — 9 units, portal as one unit, single feature branch, include the cheap Tier-3 enablers.
