# Requirements Verification Questions

**Stage**: INCEPTION — Requirements Analysis
**Instructions**: Fill in each `[Answer]:` tag with a letter (A/B/C/…). For "X) Other", write your custom response after the tag. Save the file (or just reply in chat with your answers). I will not proceed past this gate until these are answered.

**Intent analysis (my read):**
- **Request type**: Bug Fix + Refactoring + Enhancement (remediate a large, cross-cutting findings inventory)
- **Scope**: System-wide (backend, infra, all 3 UIs, tests)
- **Complexity**: Complex (43 findings across 5 tiers; includes a React+MUI portal rewrite)
- **Depth**: Comprehensive

---

## SCOPE QUESTIONS

### Question 1: Which tiers are in scope for THIS remediation run?
The findings span Tier 0 (live bugs) through Tier 4 (UI polish). Some — the whole commercial layer (billing, quota, GDPR) and deep infra items — are large features in their own right.

A) **Tier 0 + Tier 1 + Tier 2 only** — fix the live bugs, critical security/cost-safety, and high-severity structural issues. Defer Tier 3 (medium ops/scale) and treat Tier 4 UI polish as part of the React+MUI portal rebuild. (Recommended — highest value, bounded scope.)

B) **Tier 0 + Tier 1 + Tier 2 + all UI (Tier 4)** — the above plus every UI/UX detail item, but still defer Tier 3 backend/infra scale/ops.

C) **Everything (Tier 0–4)** — remediate the entire inventory including the commercial layer (billing/quota/GDPR) and all infra/ops items. Largest scope; billing especially is a net-new feature set.

D) **Tier 0 only, first** — just the four live bugs as a fast contained pass; re-plan the rest afterward.

X) Other (describe after [Answer]:)

[Answer]: 

---

### Question 2: The commercial/cost-safety layer (finding 1.1 + 2.11) — how far in this run?
Finding **1.1** (uncapped model spend — usage counted but never enforced) is the single highest-dollar-risk item, but "full billing" is a big feature. There's a cheap safety net vs. the full build.

A) **Enforcement only (recommended)** — read the existing `USAGE#` counters and enforce a per-tenant monthly quota + automatic kill-switch on breach. No Stripe, no plans UI. Closes the runaway-spend hole cheaply.

B) **Enforcement + budget alarms** — the above plus AWS Budgets/cost alarms (finding 3.18) so you're paged on spend.

C) **Full billing** — Stripe checkout, plans, subscription gating, GDPR deletion. Large; effectively a new phase.

D) **Defer entirely** — leave spend uncapped for now (only acceptable if no real tenants yet).

X) Other (describe after [Answer]:)

[Answer]: 

---

### Question 3: Sequencing / delivery — how do you want the work landed?
The repo's own workflow (PROGRESS.md phase-gates) suggests grouped commits with a reviewer pass.

A) **One unit per commit, gated (recommended)** — I remediate one unit (e.g. "chat data-layer bugs"), run tests + a reviewer-subagent pass, commit with a conventional message, update PROGRESS.md, and pause for your review before the next unit. Matches your CLAUDE.md workflow.

B) **Batch Tier 0 quick wins first** — bundle all four live bugs into one pass/commit, then proceed unit-by-unit for the rest.

C) **One big branch, review at the end** — do all in-scope work, then one review + one merge.

X) Other (describe after [Answer]:)

[Answer]: 

---

### Question 4: Portal rewrite confirmation (React + MUI)
You already chose **React + MUI** for the portal, **widget stays vanilla**, **marketing stays static HTML**. Confirming this holds and asking depth:

A) **Whole portal in one unit** — auth (stepper) + full dashboard (basics/appearance/knowledge/key/sessions) rebuilt in React+MUI with react-hook-form+zod validation, in one unit. (Recommended for a cohesive result.)

B) **Auth flow first as a separate unit** — prove the React+MUI+validation approach on the signup→verify→login stepper, review it, then do the dashboard as a second unit.

C) Reconsider the framework (I'll re-open the stack decision).

X) Other (describe after [Answer]:)

[Answer]: 

---

## EXTENSION OPT-INS (required by the workflow)

### Question 5: Security Extensions
Should security extension rules be enforced for this project?

A) Yes — enforce all SECURITY rules as blocking constraints (recommended for production-grade applications)

B) No — skip all SECURITY rules (suitable for PoCs, prototypes, and experimental projects)

X) Other (please describe after [Answer]: tag below)

[Answer]: 

---

### Question 6: Resiliency Extensions
Should the resiliency baseline be applied to this project?

**What this extension is.** Enabling it applies **directional, design-time best practices** for resilient systems, derived from the **AWS Well-Architected Framework (Reliability Pillar)** — fault tolerance, high availability, observability, recoverability.

**What this extension is NOT.** It does **not** make your workload production-ready or certify any availability/RTO/RPO target. It is a **starting point**, not a substitute for a formal Well-Architected Review.

A) Yes — apply the resiliency baseline as directional best practices and design-time guidance (recommended for business-critical workloads)

B) No — skip the resiliency baseline (suitable for PoCs, prototypes, experimental projects)

X) Other (please describe after [Answer]: tag below)

[Answer]: 

---

### Question 7: Property-Based Testing Extension
Should property-based testing (PBT) rules be enforced for this project?

A) Yes — enforce all PBT rules as blocking constraints (recommended for projects with business logic, data transformations, serialization, or stateful components)

B) Partial — enforce PBT rules only for pure functions and serialization round-trips

C) No — skip all PBT rules (suitable for simple CRUD/UI-only projects)

X) Other (please describe after [Answer]: tag below)

[Answer]: 

---

## MY RECOMMENDATION (if you want a fast default)

If you just want to move: **1=A, 2=A, 3=A, 4=A, 5=A, 6=A, 7=B**. That remediates the live bugs + critical security + high-severity structural issues + the full React+MUI portal, closes the spend hole cheaply, lands work unit-by-unit with review gates, and enforces security + resiliency + property-based tests where they add the most value — while deferring the full billing product and the deepest infra/ops items to a later run.

[Overall: use my recommendation? Yes / No / see individual answers above]: 
