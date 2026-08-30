interface WidgetSettings {
  siteKey: string;
  chatOrigin: string;
  apiBase: string;
}

interface Branding {
  displayName: string;
  greeting: string;
  color: string;
}

interface PageContext {
  url: string;
  title: string;
  description?: string;
  text: string;
}

// Capture a snapshot of the host page for first-message grounding. Runs on the
// parent document (the iframe has no access to it). Caps mirror the backend
// contract (title 300 / description 1000 / text 12000) so the request never
// exceeds what the server will accept. The widget's own host node is excluded
// so the bubble/frame markup never leaks into the captured text.
function capturePage(): PageContext {
  const meta = (sel: string): string =>
    (
      document.querySelector<HTMLMetaElement>(sel)?.content ?? ""
    ).trim();
  const description =
    meta('meta[name="description"]') ||
    meta('meta[property="og:description"]') ||
    undefined;

  let text = "";
  const body = document.body;
  if (body) {
    const clone = body.cloneNode(true) as HTMLElement;
    // Drop the widget's own DOM and non-content nodes from the captured text.
    clone
      .querySelectorAll(
        "[data-platform-widget],script,style,noscript,template,svg"
      )
      .forEach((n) => n.remove());
    text = (clone.innerText || clone.textContent || "")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  return {
    url: location.href.slice(0, 2048),
    title: (document.title || "").slice(0, 300),
    description: description ? description.slice(0, 1000) : undefined,
    text: text.slice(0, 12000)
  };
}

function resolveScript(): HTMLScriptElement | null {
  const current = document.currentScript as HTMLScriptElement | null;
  if (current?.dataset.siteKey) return current;
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    "script[data-site-key]"
  );
  return scripts.length ? scripts[scripts.length - 1]! : null;
}

function readSettings(script: HTMLScriptElement): WidgetSettings | null {
  const siteKey = script.dataset.siteKey;
  if (!siteKey) return null;
  const chatOrigin = script.dataset.chatOrigin ?? new URL(script.src).origin;
  const apiBase = script.dataset.apiBase ?? "";
  return { siteKey, chatOrigin, apiBase };
}

function bubbleStyles(): string {
  return `
    :host { all: initial; }
    .bubble {
      position: fixed; bottom: 22px; right: 22px; width: 60px; height: 60px;
      border-radius: 50%; border: none; cursor: pointer; z-index: 2147483000;
      display: grid; place-items: center; color: #fff;
      background: linear-gradient(135deg, #8271ec, #6d5ae6);
      box-shadow: 0 14px 34px -10px rgba(109,90,230,.7), 0 2px 6px rgba(20,19,26,.18);
      transition: transform .16s ease, box-shadow .16s ease;
    }
    .bubble:hover { transform: translateY(-2px); box-shadow: 0 20px 40px -10px rgba(109,90,230,.75); }
    .bubble svg { width: 26px; height: 26px; }
    .frame {
      position: fixed; bottom: 94px; right: 22px; width: 384px; height: 600px;
      max-width: calc(100vw - 32px); max-height: calc(100vh - 120px);
      border: none; border-radius: 26px; z-index: 2147483000;
      box-shadow: 0 28px 70px -18px rgba(20,19,26,.34), 0 2px 6px rgba(20,19,26,.06);
      display: none; background: #fff;
    }
    .frame.open { display: block; }
    @media (max-width: 480px) {
      .frame.open {
        inset: 0; width: 100%; height: 100%;
        max-width: none; max-height: none; border-radius: 0;
      }
    }
  `;
}

async function handshake(
  settings: WidgetSettings
): Promise<
  | { ok: true; token: string; branding: Branding }
  | { ok: false; code: string }
> {
  try {
    const res = await fetch(`${settings.apiBase}/v1/widget/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ siteKey: settings.siteKey })
    });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.token && body?.branding) {
      return { ok: true, token: body.token as string, branding: body.branding };
    }
    return { ok: false, code: body?.error?.code ?? "unavailable" };
  } catch {
    return { ok: false, code: "network" };
  }
}

function boot(): void {
  const script = resolveScript();
  if (!script) return;
  const settings = readSettings(script);
  if (!settings) return;

  const host = document.createElement("div");
  host.setAttribute("data-platform-widget", "");
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = bubbleStyles();
  shadow.appendChild(style);

  const bubble = document.createElement("button");
  bubble.className = "bubble";
  bubble.type = "button";
  bubble.setAttribute("aria-label", "Open chat");
  bubble.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 20l1.4-4.2' +
    'A8.5 8.5 0 1 1 21 11.5z"></path></svg>';
  shadow.appendChild(bubble);

  const chatIcon = bubble.innerHTML;
  const closeIcon =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M18 6 6 18M6 6l12 12"></path></svg>';

  let frame: HTMLIFrameElement | null = null;
  let session: Awaited<ReturnType<typeof handshake>> | null = null;

  function postToFrame(): void {
    if (!frame?.contentWindow || !session) return;
    // Capture the page fresh at post time (title/content may have changed since
    // load — e.g. SPA route changes). The chat app sends it only on the first
    // message; the backend re-sends it to the model only when it has changed.
    const pageContext = capturePage();
    frame.contentWindow.postMessage(
      {
        type: "platform:session",
        session,
        apiBase: settings!.apiBase,
        pageContext
      },
      settings!.chatOrigin
    );
  }

  function setOpen(open: boolean): void {
    frame?.classList.toggle("open", open);
    bubble.setAttribute("aria-expanded", String(open));
    bubble.setAttribute("aria-label", open ? "Close chat" : "Open chat");
    bubble.innerHTML = open ? closeIcon : chatIcon;
    if (!open) bubble.focus();
  }

  window.addEventListener("message", (ev) => {
    if (ev.origin !== settings.chatOrigin) return;
    if (ev.source !== frame?.contentWindow) return;
    if (ev.data?.type === "platform:ready") {
      // A `platform:ready` after a FAILED session is a retry ("Try again"):
      // re-run the handshake before re-posting, otherwise we'd just re-send the
      // cached failed session and the user is stuck in the unavailable state.
      if (!session || session.ok === false) {
        void handshake(settings).then((s) => {
          session = s;
          postToFrame();
        });
      } else {
        postToFrame();
      }
    }
    // The chat requested close (header X or Esc) — hide the frame and return
    // focus to the launcher. Critical on mobile where the frame is fullscreen.
    if (ev.data?.type === "platform:close") setOpen(false);
  });

  bubble.setAttribute("aria-expanded", "false");
  bubble.addEventListener("click", async () => {
    if (!frame) {
      frame = document.createElement("iframe");
      frame.className = "frame";
      const src = new URL("/", settings.chatOrigin);
      src.searchParams.set("parentOrigin", window.location.origin);
      frame.src = src.toString();
      frame.setAttribute("title", "Chat");
      shadow.appendChild(frame);
      session = await handshake(settings);
      postToFrame();
    }
    setOpen(!frame.classList.contains("open"));
  });

  document.body.appendChild(host);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
