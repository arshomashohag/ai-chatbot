# Findings → Units Map

User Stories were skipped (remediation, not feature discovery), so this maps **review findings** to units instead of stories. Every in-scope finding is assigned to exactly one unit. Source IDs reference `reverse-engineering/review-findings.md`.

| Finding | Title (short) | Tier | Unit | Requirement |
|---|---|---|---|---|
| 0.1 | Chat history oldest-first / amnesia | 0 | U1 | FR-1.1 |
| 0.2 | Message-write data loss + BatchWrite>25 | 0 | U1 | FR-1.2, FR-1.3 |
| 0.3 | Widget can't close on mobile / no Esc | 0 | U5 | FR-2.1 |
| 0.4 | Post-confirmation not idempotent | 0 | U1 | FR-1.4 |
| 1.1 | Uncapped model spend / no quota enforcement | 1 | U3 | FR-5.1, FR-5.2 |
| 1.2 | Bearer token not Origin-bound | 1 | U2 | FR-4.1 |
| 1.3 | Portal stored XSS | 1 | U6 | FR-4.2 |
| 1.4 | JWT key cache ignores keyId; no kid/iss/aud | 1 | U2 | FR-4.3 |
| 1.5 | No CSP on any surface | 1 | U7 | FR-4.4 |
| 2.1 | LeadingKeys not isolation → tenant guard | 2 | U9 | FR-4.6 |
| 2.2 | Deploy serves broken/half-synced assets | 2 | U8 | FR-6.1 |
| 2.3 | OIDC dev/staging trust too broad; no SRI | 2 | U8 | FR-6.2 |
| 2.4 | Chat handler zero tests | 2 | U9 | FR-7.1 |
| 2.5 | No rollback / smoke gate / staging gate | 2 | U8 | FR-6.3 |
| 2.6 | CORS missing on error responses | 2 | U4 | FR-4.5 |
| 2.7 | Rate-limit/usage failures 500 the user | 2 | U4 (+U1 persist) | FR-1.3, FR-4 |
| 2.8 | Portal silent saves / snippet / auth wall / color / tone | 2 | U6 | FR-3.4, FR-3.5, FR-3.6, FR-3.1 |
| 2.9 | No client-side validation | 2 | U6 | FR-3.2 |
| 2.10 | Design system copied not imported; AA contrast | 2 | U7 | FR-3, NFR-a11y |
| 4.1 | Auth 3-forms-stacked | 4 | U6 | FR-3.1 |
| 4.2 | No empty states | 4 | U6 | FR-3.7 |
| 4.3 | Raw Cognito errors shown | 4 | U6 | FR-3.3 |
| 4.4 | No empty/onboarding states | 4 | U6 | FR-3.7 |
| 4.5 | No onboarding / logged-in identity | 4 | U6 | FR-3.7 |
| 4.6 | Snippet no copy button | 4 | U6 | FR-3.5 |
| 4.7 | Color free-text wrong default | 4 | U6 | FR-3.6 |
| 4.8 | Tone select not reflected | 4 | U6 | FR-3.6 |
| 4.9 | Allowed-domain single truncation | 4 | U6 | FR-3.9 |
| 4.10 | Auth a11y (autocomplete/inputmode/aria) | 4 | U6 | FR-3.10 |
| 4.11 | Widget no close/Esc | 4 | U5 | FR-2.1 |
| 4.12 | Failed send discards message | 4 | U5 | FR-2.2 |
| 4.13 | Unavailable dead-end | 4 | U5 | FR-2.3 |
| 4.14 | Suggested prompts hardcoded | 4 | U5 | FR-2.4 |
| 4.15 | Bot links not clickable / no wrap | 4 | U5 | FR-2.5 |
| 4.16 | No aria-live on chat log | 4 | U5 | FR-2.6 |
| 4.17 | Brand color no contrast check | 4 | U5 | FR-2.7 |
| 4.18 | Marketing CTAs all → /app | 4 | U7 | FR (marketing) |
| 4.19 | Live demo undiscoverable | 4 | U7 | FR (marketing) |
| 4.20 | No responsive nav | 4 | U7 | FR (marketing) |
| 4.21 | #6D5AE6 fails AA on white | 4 | U7 (+U6) | NFR-a11y |
| 4.22 | Brand name inconsistent | 4 | U7 | FR (marketing) |
| 4.23 | Two bubble designs / class mismatch | 4 | U7 (+U6) | FR-3 |
| 3.9 | Unguarded JSON.parse (enabler) | 3 | U4 | FR-4 |
| 3.10 | messageCount never written (enabler) | 3 | U1 | FR-3.8 |
| 3.13 | Rate-limiter TTL landmine | 3 | U4 | FR-4 |
| 3.21 | Debug-OIDC permanent (enabler) | 3 | U8 | FR-6 |
| 3.22 | apiBase redirect token exfil | 3→pulled | U2 | FR-4.7 |
| 3.27 | JWT tests missing | 3 | U9 | FR-7.2 |
| 3.28 | Rate-limiter tests missing | 3 | U9 | FR-7.2 |
| 3.29 | Site-key rotation untested | 3 | U9 | FR-7.2 |
| 3.30 | Post-confirm idempotency untested | 3 | U9 | FR-7.2 |
| 3.31 | CDK stack tests thin | 3 | U9 | FR-7.2 |

## Coverage check
- **All Tier 0** (0.1–0.4) → assigned ✅
- **All Tier 1** (1.1–1.5) → assigned ✅
- **All Tier 2** (2.1–2.10) → assigned ✅  *(2.11 GDPR deletion explicitly deferred — out of scope, tracked in findings doc)*
- **All Tier 4 UI** (4.1–4.23) → assigned ✅
- **Cheap Tier-3 enablers** (3.9, 3.10, 3.21) + pulled-in security items (3.22) and test items (3.27–3.31) → assigned ✅
- **Deferred Tier-3** (3.1–3.8, 3.11–3.20, 3.23–3.26, 2.11) → NOT assigned (out of scope this run, documented for follow-up) ✅

Every in-scope finding maps to exactly one owning unit.
