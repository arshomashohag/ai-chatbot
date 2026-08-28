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
