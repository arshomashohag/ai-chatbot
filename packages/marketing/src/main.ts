// Use the shared design system directly (imported, not copy-pasted) so the
// marketing site can't drift from the tokens.
import "@platform/shared/design/tokens.css";
import { drawPercent, stationReached } from "./walkthrough.js";

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

// --- Setup walkthrough: scroll-driven pipeline + self-typing conversation ---
// The pure scroll math lives in walkthrough.ts (unit-tested); this wires it to
// the DOM. Everything degrades to a fully-resolved static state under
// prefers-reduced-motion.
(function walkthrough(): void {
  const track = document.getElementById("track");
  const convo = document.getElementById("convo");
  const replay = document.getElementById("replay");
  if (!track || !convo) return;

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const steps = [...document.querySelectorAll<HTMLElement>("[data-step]")];
  const root = document.documentElement;
  let convoPlayed = false;

  const wait = (ms: number): Promise<void> =>
    new Promise((r) => setTimeout(r, reduce ? 0 : ms));

  const shield =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" ' +
    'stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 ' +
    '10 8 10z"></path></svg>';

  const question = "Do you ship to Canada, and how long does it take?";
  const answer =
    "Yes — we ship to Canada. Standard delivery is 5–7 business days, and " +
    "it's free over $75.";

  function bubble(role: "user" | "bot", text: string): HTMLDivElement {
    const d = document.createElement("div");
    d.className = `msg ${role}`;
    d.textContent = text;
    return d;
  }

  async function playConvo(): Promise<void> {
    convo!.innerHTML = "";
    convo!.append(bubble("user", question));
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `${shield} Grounded in your FAQ`;
    if (reduce) {
      chip.style.opacity = "1";
      convo!.append(chip);
      convo!.append(bubble("bot", answer));
      return;
    }
    await wait(700);
    convo!.append(chip);
    await wait(650);
    const typing = document.createElement("div");
    typing.className = "msg bot";
    typing.innerHTML =
      '<span class="typing-dots"><span></span><span></span><span></span></span>';
    convo!.append(typing);
    await wait(900);
    typing.remove();
    convo!.append(bubble("bot", answer));
  }

  function startConvo(): void {
    if (convoPlayed) return;
    convoPlayed = true;
    void playConvo();
  }

  function onScroll(): void {
    const r = track!.getBoundingClientRect();
    const vh = window.innerHeight;
    root.style.setProperty("--draw", `${drawPercent(r.top, r.height, vh)}%`);
    for (const s of steps) {
      const node = s.querySelector(".node");
      if (node && stationReached(node.getBoundingClientRect().top, vh)) {
        s.classList.add("on");
      }
    }
    if (steps.length && steps[steps.length - 1]!.classList.contains("on")) {
      startConvo();
    }
  }

  replay?.addEventListener("click", () => {
    convoPlayed = true;
    void playConvo();
  });

  if (reduce) {
    root.style.setProperty("--draw", "100%");
    steps.forEach((s) => s.classList.add("on"));
    startConvo();
  } else {
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
  }
})();

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
