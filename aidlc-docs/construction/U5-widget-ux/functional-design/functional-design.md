# U5 — Functional Design: Widget UX (vanilla)

**Unit**: U5 · **Findings**: 0.3, 4.11, 4.12, 4.13, 4.14, 4.15, 4.16, 4.17
**Requirements**: FR-2.1…2.7 · **Constraint**: widget must stay < 30KB gz.
**Extensions**: SECURITY (XSS-safe link rendering), a11y (NFR-Accessibility).

## Problems (verified in current code)
- **0.3 / 4.11** No close button; no Esc. Loader toggles `.open` on the frame; on mobile the frame is fullscreen `inset:0` and covers the only launcher → trap. `chat.html` header is avatar+title only; `chat/main.ts` has no Escape listener.
- **4.12** `send()` sets `input.value = ""` (main.ts:90) *before* the fetch, so on failure the typed text is lost.
- **4.13** `renderUnavailable()` (main.ts:81) hides the composer (CSS) with no retry.
- **4.14** `SUGGESTED` (main.ts:8-12) hardcoded e-commerce prompts for every tenant.
- **4.15** `appendMessage` uses `textContent` (XSS-safe, good) but URLs aren't clickable and there's no `overflow-wrap` → long tokens overflow.
- **4.16** `#log` has no `aria-live`; typing indicator is outside any live region → screen readers get silence.
- **4.17** `renderConnected` sets `--wa` from `branding.color` (main.ts:72) with no contrast validation → a pale brand color makes white header/bubble text unreadable.

## Design

### D1 — close affordance: header X + Esc + launcher toggle (0.3, 4.11)
The close spans two documents (chat iframe ↔ parent loader) via the existing postMessage channel.
- **chat.html**: add a header close button (`#close`, aria-label "Close chat") in `#headbar`.
- **chat/main.ts**: clicking `#close` OR pressing `Escape` posts `{ type: "platform:close" }` to `parentOrigin` (the already-trusted parent). Add a `keydown` listener for `Escape`.
- **loader.ts**: the parent's message listener (already validates `ev.origin === chatOrigin` && `ev.source === frame.contentWindow`) handles `platform:close` by removing `.open` from the frame and returning focus to the launcher bubble. Also: the launcher click already toggles; make the launcher `aria-expanded` reflect open/closed, and swap its icon to an X while open (small SVG swap).
- **Mobile**: since the close button lives in the (fullscreen) chat header, it's always reachable → trap fixed.
- Security: `platform:close` carries no data; the loader only acts on messages from the validated chat frame/origin. No new trust surface.

### D2 — preserve typed message on failed send + retry (4.12, 4.13)
- In `send()`, capture the text, but **don't clear the input until the request succeeds** (or clear it and restore on failure). Chosen: clear on send (keeps the optimistic UX), and on network/5xx failure **restore the input value** and re-enable send, plus append a bot error bubble with a "Tap to retry" affordance (or simply restore the text so the user can hit send again). Minimal: restore `input.value = text` in the catch/failure path.
- `renderUnavailable()` gains a "Try again" button that re-posts `platform:ready` to re-request a session (re-handshake). The composer stays hidden only until retry succeeds.

### D3 — config-driven suggested prompts (4.14)
- Add optional `suggestedPrompts?: string[]` to `Branding` (shared `session.ts` contract). The session handler populates it from the tenant's KB entry titles (up to 3) when available; empty/absent otherwise.
  - The session handler already resolves the tenant; add a `listKb(tenantId)` read (bounded) and map the first 3 enabled titles. This mirrors the chat handler's existing KB read. Requires granting the session Lambda `Query` on the base table for `KB#` (it already has GetItem/PutItem + GSI query; add KB query — scoped by LeadingKeys TENANT#*, already present).
  - **Decision to bound scope**: if wiring the session Lambda's KB read proves to need an IAM change beyond the existing LeadingKeys grant, fall back to: ship `suggestedPrompts` in the contract, populate when present, and in the widget **only render the Suggested block if prompts exist** — with NO hardcoded e-commerce fallback (removing the wrong-industry prompts is the actual fix). The greeting alone is a fine empty state.
- Widget: `renderSuggested(prompts)` takes the array from `branding.suggestedPrompts`; renders nothing if empty. Removes the hardcoded `SUGGESTED`.

### D4 — safe clickable links + word-wrap (4.15)
- `appendMessage` builds the bubble by splitting text on a URL regex and appending text nodes + `<a>` elements. Anchor label uses `textContent` (never innerHTML), `href` validated to `http(s):`, `target="_blank"`, `rel="noopener noreferrer"`. Non-URL segments stay text nodes → XSS-safe (no innerHTML of model output).
- CSS: add `overflow-wrap: anywhere` (and `word-break: break-word`) to `.msg` in chat.html.

### D5 — aria-live announcements (4.16)
- `#log` gets `role="log"` `aria-live="polite"` `aria-relevant="additions"` in chat.html so new bot messages are announced.
- The typing indicator: add visually-hidden text "Assistant is typing…" inside the live region (or set `aria-live` appropriately) so the pause is announced. Keep the animated dots decorative (`aria-hidden`).

### D6 — brand-color contrast validation (4.17)
- Before applying `--wa`, validate the tenant color has sufficient contrast against white (the header/bubble text color). Compute relative luminance; if contrast(white, color) < ~2.5:1 (the header/bubbles use white text on the color), fall back to the platform accent `#6d5ae6` (which passes) rather than the tenant's unreadable color. Small pure `contrastOk(hex)` helper.
- Keep it tiny (bundle budget): parse `#rrggbb`, compute luminance, compare.

## Bundle budget
All additions are vanilla JS/CSS; target stays < 30KB gz. The link-parsing + contrast helpers are small. Verify with `pnpm widget:size` after build.

## Testable Properties (PBT-01)
- `contrastOk(hex)` — pure; property: returns boolean, and known-good/known-bad colors classify correctly. Example-based (small domain) rather than PBT.
- URL-splitting — example-based (specific inputs incl. adversarial `javascript:` which must NOT become a link).
PBT N/A for U5 (UI logic; the pure helpers are small-domain example-tested).

## Security / a11y compliance
- **SECURITY (XSS)**: link rendering never uses innerHTML on model output; `javascript:`/`data:` hrefs rejected (only http/https linkified). ✅
- **a11y**: aria-live log, aria-expanded launcher, keyboard Esc, focus return, close button labeled. ✅
- **SECURITY-08**: `platform:close` handled only from the validated chat frame/origin. ✅

## Definition of Done
- Close button + Esc close the widget on desktop AND mobile; focus returns to launcher; launcher aria-expanded toggles — verified (E2E/manual).
- Failed send restores the typed text; unavailable state offers retry — test/manual.
- Suggested prompts come from config (or render nothing); no hardcoded e-commerce — verified.
- URLs in bot replies are clickable + safe; long tokens wrap — test.
- `#log` is an aria-live region — asserted in markup.
- Unreadable brand color falls back to accent — unit test on `contrastOk`.
- Widget < 30KB gz; E2E handshake still green (data-testid preserved); typecheck + lint clean.
