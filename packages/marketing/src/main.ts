// The portal (signup/login) lives on a different subdomain/distribution than
// this marketing site, so the CTA links must point at its absolute origin.
// The HTML ships relative "/app" placeholders; rewrite them at load time.
const portalUrl = import.meta.env.VITE_PORTAL_URL;
if (portalUrl) {
  for (const a of document.querySelectorAll<HTMLAnchorElement>(
    'a[href="/app"]'
  )) {
    a.href = portalUrl;
  }
}

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
