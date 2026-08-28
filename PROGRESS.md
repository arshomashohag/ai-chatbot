# Implementation Progress

Multi-tenant AI chatbot platform. Phases per `docs/chatbot-platform-implementation-plan.md`.

## Status

| Phase | Description | State |
|---|---|---|
| P0 | Monorepo scaffold + CI/CD | ✅ complete |
| P1 | Widget + session auth | ⬜ not started |
| P2 | Chat pipeline + model + one tool | ⬜ not started |
| P3 | Abuse protection | ⬜ not started |
| P4 | Marketing site + tenant portal v1 | ⬜ not started |

## Gate checklist (each phase)
tests green → reviewer subagent pass → conventional commit → PROGRESS update.

## Open WARNs / TODOs
- [P1] Widget must import zod contracts from `@platform/shared` (session request/response) so contract drift is caught in CI. Dependency declared; binding lands with the session call. (reviewer P0 #2)
- [P1] Health/tenant Lambdas: scope DynamoDB grants with `dynamodb:LeadingKeys` on tenant PK when tenant logic lands. (reviewer P0 #3)

## P0 gate
- ci:local green: lint · typecheck · vitest (3) · widget build+size (0.35KB gz ≤30KB) · cdk synth.
- Reviewer pass: 0 BLOCKER, 5 WARN. Fixed: prod trigger decoupled from staging tag (#1), cdk.context.json untracked+ignored (#4), CI synth uses stub zone id / no fromLookup (#5). Deferred to P1: #2, #3 (above).

## Blockers
_(none)_
