# U7 — Functional Design: Marketing + CSP + design-system

**Unit**: U7 · **Findings**: 1.5, 2.10, 4.18, 4.19, 4.20, 4.21, 4.22, 4.23
**Requirements**: FR-4.4, FR-3, NFR-a11y · **Extensions**: SECURITY-04 (CSP + headers).

## Problems (verified)
- **1.5 — no CSP**: the single shared `ResponseHeadersPolicy` (`edge-stack.ts:45-59`) sets nosniff/HSTS/referrer/`frame-options: DENY` but **no CSP**. Also `X-Frame-Options: DENY` is applied to the **chat** distribution, which is *designed to be framed* by the widget — wrong control.
- **2.10 — design system copied not imported**: `packages/shared/design/tokens.css` is never imported anywhere (grep confirms); each UI re-declares a token subset inline → drift. `#6D5AE6` on white ≈ 3.7:1 fails WCAG AA for text.
- **4.18** all marketing CTAs → `/app` (login, signup, "See how it works" all the same).
- **4.19** the dogfooded live-demo widget is undiscoverable.
- **4.20** nav isn't responsive.
- **4.21** `#6D5AE6` link/ghost text fails AA.
- **4.22** brand name inconsistent across UIs.
- **4.23** two different bubble designs / naming.

## Design

### D1 — per-surface CSP via CDK (1.5, SECURITY-04)
Replace the single shared `securityHeaders` policy with **per-surface** `ResponseHeadersPolicy` objects, each with a `contentSecurityPolicy` built from `config.subdomains` (env-independent — no hardcoded origins). External hosts in use: Google Fonts (`fonts.googleapis.com` CSS, `fonts.gstatic.com` fonts) everywhere; the portal calls Cognito + the API via fetch; marketing dogfoods the widget (loads `cdn`/`chat`, fetches `api`).

Policies (all include `default-src 'none'; object-src 'none'; base-uri 'none'`):

- **cdn (widget.js)**: `script-src 'self'`; minimal — it's a JS asset. Keep `frame-options: DENY`.
- **chat surface**: `script-src 'self'`; `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`; `font-src https://fonts.gstatic.com`; `connect-src 'self' https://<api>`; **`frame-ancestors *`** (must be framable by any tenant site) — and **remove `X-Frame-Options`** here (replace DENY with the CSP frame-ancestors; XFO and CSP frame-ancestors conflict, CSP wins in modern browsers but XFO:DENY would still block legacy). This fixes the 1.5 sub-point.
- **marketing**: `script-src 'self' https://<cdn>` (dogfooded widget loader); `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`; `font-src https://fonts.gstatic.com`; `connect-src 'self' https://<api>`; `frame-src https://<chat>` (the widget iframe); `img-src 'self' data:`; `frame-ancestors 'none'`.
- **portal**: `script-src 'self'`; `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com` (MUI/emotion inject runtime `<style>`); `font-src https://fonts.gstatic.com`; `connect-src 'self' https://<api> https://cognito-idp.<region>.amazonaws.com`; `img-src 'self' data:`; `frame-ancestors 'none'`.

**`'unsafe-inline'` in `style-src`**: required and documented per SECURITY-04's allowance ("without documented justification"). Justification: MUI/emotion and the static HTML inject inline `<style>`; nonces/hashes are impractical for pre-built static S3 assets without a build-time CSP-hashing step (deferred). `script-src` does NOT use `'unsafe-inline'` — the XSS-relevant directive stays strict.

Implementation: a `makeSecurityHeaders(scope, id, cspString)` helper; build each CSP string from `config.subdomains`/`config.region`. `frameOptions` set only where appropriate (omit on chat).

### D2 — actually import the design system (2.10, 4.23)
- **Marketing** (static HTML): replace the inline `:root` token block + hand-rolled `.btn`/`.card` with a `<link>`/import of `@platform/shared/design/tokens.css`, then use the shared classes. Since marketing is Vite-built, `import "@platform/shared/design/tokens.css"` in `main.ts` bundles it. Delete the duplicated inline tokens; keep only page-specific layout CSS.
- **Portal** (React): `import "@platform/shared/design/tokens.css"` in `main.tsx` for the CSS variables; MUI theme already maps the same values (U6) — align the two so there's one source. (MUI components dominate; tokens.css provides the CSS vars for any raw elements.)
- **Widget/chat**: out of scope to re-plumb (vanilla, bundle-budget sensitive, its inline tokens are minimal) — but unify the **accent value** and bubble naming so they match. The widget already uses `--wa`; leave as-is (U5 touched it) — only ensure the accent constant matches `#6d5ae6`. (Full widget token import deferred — noted; low value vs bundle risk.)
- Result: marketing + portal consume the real tokens; drift removed for the two biggest surfaces.

### D3 — WCAG AA link/text color (4.21)
Everywhere `#6d5ae6` is used for **text on white** (links, ghost-button labels, kickers), switch to `--color-accent-700` (`#4f3ec0`, ~7:1). Fills/icons/large display can keep `#6d5ae6`. tokens.css already defines both; the fix is using the darker one for text. Marketing `.btn-ghost` and links updated.

### D4 — marketing CTAs (4.18, 4.19)
- Distinguish the three actions: **"Log in"** → portal (login), **"Get started free"** → portal (signup — same portal, but the copy/intent differs; the portal's auth defaults to login with a "create account" link, so both land correctly), **"See how it works"** → a real in-page anchor (`#how` / the features section or a demo callout), NOT `/app`.
- **Live demo discoverable (4.19)**: add a hero button "Try the live demo" that programmatically opens the dogfooded widget (or scrolls to a labeled callout pointing at the corner bubble). Minimal: a button that dispatches a click on the widget bubble once loaded, plus copy "Ask the assistant in the corner ↘".
- The `/app` runtime rewrite (main.ts) stays for the portal-bound links; the "See how it works" link becomes an anchor so it's not rewritten.

### D5 — responsive nav (4.20)
- Add a responsive rule: at narrow widths the nav wraps/stacks or collapses the secondary link. Minimal, no JS hamburger: `flex-wrap` + hide the ghost "Log in" on very small screens (keep the primary CTA), or stack. Keep it simple and dependency-free.

### D6 — one brand name (4.22)
- Standardize on **"AI Chatbot"** across marketing (`<title>`, brand, footer), the widget "Powered by", and the portal header (portal already says "AI Chatbot" from U6). Update marketing's "Chatbot Platform" occurrences.

## Testable Properties (PBT-01)
- CSP generation is a pure string builder from config → assert (CDK template test in U9, or a small unit here) that each policy contains the expected directives and no `script-src 'unsafe-inline'`.
- No algorithmic surface → PBT N/A.

## Security compliance (SECURITY-04)
- CSP present on every HTML-serving surface ✅; `script-src` never `'unsafe-inline'` ✅; HSTS ≥ 1y (unchanged) ✅; nosniff (unchanged) ✅; frame handling correct per surface (chat framable via `frame-ancestors`, others `'none'`/DENY) ✅; `'unsafe-inline'` limited to `style-src` with documented justification ✅.

## Definition of Done
- Each distribution serves a CSP appropriate to its surface (chat framable; others not); `script-src` strict.
- Marketing + portal import `tokens.css` (no duplicated `:root` token blocks in those two).
- Text/link `#6d5ae6`→`#4f3ec0` where on white (AA).
- Marketing: "See how it works" → in-page anchor; a discoverable live-demo affordance; responsive nav; one brand name.
- `cdk synth` clean; marketing builds; portal still builds + E2E green; typecheck + lint clean.
- A CDK/unit assertion that the chat CSP allows framing and others don't, and no `script-src 'unsafe-inline'` (can live in U9 with the other template assertions; a lightweight check here is fine).
