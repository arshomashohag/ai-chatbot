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
      position: fixed; bottom: 20px; right: 20px; width: 56px; height: 56px;
      border-radius: 50%; border: none; cursor: pointer; z-index: 2147483000;
      background: #111; color: #fff; font: 600 14px system-ui;
    }
    .frame {
      position: fixed; bottom: 88px; right: 20px; width: 380px; height: 560px;
      max-width: calc(100vw - 40px); max-height: calc(100vh - 120px);
      border: none; border-radius: 12px; z-index: 2147483000;
      box-shadow: 0 8px 30px rgba(0,0,0,.25); display: none; background: #fff;
    }
    .frame.open { display: block; }
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
  bubble.textContent = "Chat";
  shadow.appendChild(bubble);

  let frame: HTMLIFrameElement | null = null;
  let session: Awaited<ReturnType<typeof handshake>> | null = null;

  function postToFrame(): void {
    if (!frame?.contentWindow || !session) return;
    frame.contentWindow.postMessage(
      { type: "platform:session", session, apiBase: settings!.apiBase },
      settings!.chatOrigin
    );
  }

  window.addEventListener("message", (ev) => {
    if (ev.origin !== settings.chatOrigin) return;
    if (ev.source !== frame?.contentWindow) return;
    if (ev.data?.type === "platform:ready") postToFrame();
  });

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
    frame.classList.toggle("open");
  });

  document.body.appendChild(host);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
