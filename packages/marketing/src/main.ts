// Use the shared design system directly (imported, not copy-pasted) so the
// marketing site can't drift from the tokens.
import "@platform/shared/design/tokens.css";

// The portal (signup/login) lives on a different subdomain/distribution than
// this marketing site, so the CTA links must point at its absolute origin.
// The HTML ships relative "/app" placeholders; rewrite them at load time.
// The signup CTA carries ?mode=signup so the portal can open the right step.
const portalUrl = import.meta.env.VITE_PORTAL_URL;
if (portalUrl) {
  for (const a of document.querySelectorAll<HTMLAnchorElement>(
    'a[data-portal]'
  )) {
    a.href = a.dataset.portal === "signup" ? `${portalUrl}?mode=signup` : portalUrl;
  }
}

// Make the dogfooded live demo discoverable: the hero "Try the live demo"
// button opens the widget bubble once the loader has injected it.
document
  .querySelector<HTMLButtonElement>('[data-demo]')
  ?.addEventListener("click", () => {
    const host = document.querySelector("[data-platform-widget]");
    const bubble = host?.shadowRoot?.querySelector<HTMLButtonElement>(".bubble");
    if (bubble) bubble.click();
    else host?.scrollIntoView({ behavior: "smooth" });
  });

// Dogfood our own widget: inject the loader with the demo tenant's key so the
// marketing site's chat bubble answers questions about the platform itself.
const cdnOrigin = import.meta.env.VITE_CDN_ORIGIN;
const chatOrigin = import.meta.env.VITE_CHAT_ORIGIN;
const apiBase = import.meta.env.VITE_API_BASE;
const siteKey = import.meta.env.VITE_DEMO_SITE_KEY;

if (cdnOrigin && siteKey) {
  const s = document.createElement("script");
  s.src = `${cdnOrigin}/widget.js`;
  s.dataset.siteKey = siteKey;
  if (chatOrigin) s.dataset.chatOrigin = chatOrigin;
  if (apiBase) s.dataset.apiBase = apiBase;
  document.body.appendChild(s);
}
