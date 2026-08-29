# U6 — Functional Design: Portal rebuild → React + MUI

**Unit**: U6 · **Findings**: 1.3, 2.8, 2.9, 4.1–4.10, 4.21, 4.22, 4.23
**Requirements**: FR-3.1…3.10 · **Extensions**: SECURITY-05 (input validation), SECURITY-08/12 (auth), a11y.

## Goal
Replace the vanilla `innerHTML`-string portal with a React + MUI SPA that: eliminates the stored-XSS class (1.3), validates every form client-side (2.9), gives real save/error feedback (2.8), and provides a stepped auth flow, empty states, copy button, and DataGrid sessions (4.1–4.10). Keep the widget/marketing untouched.

## Hard constraints (must not break)
- **E2E `data-testid`s** (money-path): `b-name`, `b-url`, `b-dom`, `save-basics`, `k-profile`, `save-profile`, `k-title`, `k-body`, `add-kb`, `kb-item`, `issue-key`, `site-key`, `snippet`, `sess-open`, `transcript-msg`. All must remain, with the same semantics.
- **`VITE_E2E` bypass**: `currentToken()` returns `localStorage.e2e_token` when `import.meta.env.VITE_E2E` is set — preserved, but hardened (see D7).
- **API client routes** unchanged (`/v1/admin/*`), same request/response shapes (money-server mock depends on them).
- **Build output**: still a static SPA at `dist/index.html` (money-server serves it).
- **Cognito auth** via `amazon-cognito-identity-js` (same pool env vars).

## Stack
- **React 18 + TypeScript + Vite** (`@vitejs/plugin-react`).
- **MUI**: `@mui/material`, `@mui/icons-material`, `@emotion/react`, `@emotion/styled`, `@mui/x-data-grid` (sessions).
- **Forms**: `react-hook-form` + `@hookform/resolvers/zod`, reusing `packages/shared` schemas (`BusinessBasics`, `Appearance`, `KbEntryInput`, `ProfileInput`) as the validation source of truth.
- **Theme**: `createTheme` mapping the brand tokens — primary `#6d5ae6`, Plus Jakarta Sans, rounded shape — so it's Material *structure* with the platform's identity, not stock blue.

## Component architecture
```
src/
  main.tsx            # React root, ThemeProvider, CssBaseline
  theme.ts            # MUI theme from design tokens
  auth.ts             # (kept) Cognito wrappers + hardened E2E bypass
  api.ts              # (kept, ported) typed admin API client
  App.tsx             # top-level: if token → Dashboard else AuthFlow
  auth/AuthFlow.tsx   # MUI Stepper: Login | Create account | Verify
  dashboard/
    Dashboard.tsx     # layout, logged-in identity, sections
    BasicsForm.tsx    # RHF + BusinessBasics zod
    AppearanceForm.tsx# RHF + Appearance zod (color picker, tone select)
    KnowledgeSection.tsx # profile RHF + FAQ add/list with empty state
    KeySection.tsx    # issue key + copy buttons
    SessionsSection.tsx  # DataGrid + transcript drawer
  hooks/useSnackbar.tsx  # global success/error toast
```

## Design details

### D1 — kill stored XSS (1.3)
React escapes all interpolated values by default (`{cfg.basics?.name}` renders as text, never HTML). No `dangerouslySetInnerHTML` anywhere. This structurally eliminates the `innerHTML`-interpolation XSS class — the finding is fixed by the framework choice, verified by a lint/grep gate (no `dangerouslySetInnerHTML`).

### D2 — stepped auth (4.1)
`AuthFlow` is an MUI `Stepper`/state machine with modes: **login** (default), **signup**, **verify**, **forgot** (stretch). 
- Login form (email, password) → on success, App re-renders to Dashboard.
- "Create account" link → signup form; on success, **auto-advance to verify with the email prefilled** and code field focused.
- Verify (email prefilled, code) → on success, switch to login with a success message.
- Resend-code action on the verify step.
- All Cognito errors mapped to human copy (D4).

### D3 — client-side validation (2.9)
Every form uses `react-hook-form` with `zodResolver(<sharedSchema>)`:
- Basics → `BusinessBasics`; Appearance → `Appearance`; FAQ → `KbEntryInput`; Profile → `ProfileInput`.
- Auth: a local zod schema (email format, password min-length per Cognito policy — min 8, upper/lower/number) so the user sees inline errors *before* submit instead of a round-trip Cognito exception.
- Submit buttons disabled while `!formState.isValid` or submitting. Inline `helperText` per field via MUI `TextField error/helperText`.

### D4 — humanized errors (4.3) + save feedback (2.8, 4.4)
- A `mapAuthError(err)` maps common Cognito codes/messages (`UsernameExistsException`, `CodeMismatchException`, `NotAuthorizedException`, password-policy) to plain copy.
- A global `useSnackbar` shows MUI `Snackbar` + `Alert` on **every** mutation — success ("Saved") AND error (mapped message). Every `api.*` call is wrapped so a rejection surfaces a red snackbar (fixes the silent-save bug: no more `.then(flash)` without `.catch`).

### D5 — dashboard pieces
- **Embed snippet (4.6)**: `KeySection` renders the key + snippet in MUI `TextField`/`code` blocks each with a **Copy** button (`navigator.clipboard.writeText`) + "copied" snackbar. Reassurance copy ("You can regenerate a key any time"). Keeps `data-testid="site-key"`/`"snippet"` on the value elements and `"issue-key"` on the button.
- **Appearance (4.7, 4.8)**: color via `<input type="color">` (MUI-styled) defaulting to `#6d5ae6`; tone via MUI `Select` **bound to the saved value** (controlled).
- **Allowed domains (4.9)**: repeatable rows (add/remove) with helper text "The widget only runs on these domains." Keep `data-testid="b-dom"` on the first row's input (E2E fills one).
- **Empty states (4.4, 4.2)**: KB list shows "No FAQs yet — add your first question above" when empty; Sessions shows "No conversations yet." when empty.
- **Onboarding / identity (4.5, 4.10)**: a top bar showing the signed-in email + Log out; a simple step indicator (Basics → Appearance → Knowledge → Key). Auth inputs get `autoComplete`/`inputMode` (email, current/new-password, one-time-code).
- **Sessions (4.4)**: MUI `DataGrid` with columns (origin, messages, when); clicking a row (`data-testid="sess-open"`) opens the transcript (`data-testid="transcript-msg"` per message). Timestamps rendered.

### D6 — design-system consistency (4.21, 4.22, 4.23)
- Theme primary uses `#6d5ae6`; links/ghost text use the darker `#4f3ec0` (`--color-accent-700`) to pass WCAG AA (4.21).
- One brand name — "AI Chatbot" — in the title/header (4.22).
- Transcript bubbles reuse a shared bubble style consistent with the widget naming (`user`/`assistant`) (4.23).

### D7 — harden the E2E bypass (3.25, related)
`currentToken()`: gate the bypass on `import.meta.env.DEV || import.meta.env.MODE !== "production"` in addition to `VITE_E2E`, and add a build-time guard that throws if `VITE_E2E` is set while building for production. Fail-closed: a prod bundle can never take the bypass branch.

## Testable Properties (PBT-01)
- `mapAuthError` — pure mapping; example-based (known codes → known copy).
- Validation is delegated to the shared zod schemas (already/also covered where those schemas are tested).
- UI behavior (stepper, snackbar, copy) — verified via the money-path E2E + a light React Testing Library smoke test for the auth stepper and a form's invalid→disabled state.
PBT N/A for U6 (UI + thin mapping; no algorithmic/serialization surface).

## Security / a11y compliance
- **1.3 XSS**: React escaping + no `dangerouslySetInnerHTML` (grep-gated). ✅
- **SECURITY-05**: every form validated by a zod schema before submit. ✅
- **SECURITY-12**: password policy surfaced client-side; errors humanized; tokens still via Cognito (localStorage storage tradeoff documented — the HttpOnly-cookie migration is a larger, separate effort noted in findings as H1, not in U6 scope; U6 does NOT regress it and removes the XSS that made it exploitable). ✅
- **a11y**: MUI components ship labels/focus; add `autoComplete`/`inputMode`; Snackbar is `aria-live` by default; DataGrid is keyboard-navigable. ✅

## Definition of Done
- Portal builds to `dist/`; money-path E2E green (all preserved testids work end-to-end).
- No `dangerouslySetInnerHTML` in the portal (grep gate).
- Every form blocks invalid input before POST; every mutation shows success AND error feedback.
- Auth is a stepped flow; email carries signup→verify; errors humanized.
- Snippet has a copy button; color picker defaults to brand; tone reflects saved value; empty states present; signed-in identity shown.
- `VITE_E2E` bypass can't ship to a production build (guard).
- typecheck + lint clean; a light RTL smoke test passes.
