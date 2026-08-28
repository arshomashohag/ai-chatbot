function resolveScript(): HTMLScriptElement | null {
  const current = document.currentScript as HTMLScriptElement | null;
  if (current?.dataset.siteKey) return current;
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    'script[data-site-key]'
  );
  return scripts.length ? scripts[scripts.length - 1]! : null;
}

function boot(): void {
  const script = resolveScript();
  if (!script) return;
  const siteKey = script.dataset.siteKey;
  if (!siteKey) return;
  const host = document.createElement("div");
  host.setAttribute("data-platform-widget", "");
  const shadow = host.attachShadow({ mode: "open" });
  const bubble = document.createElement("button");
  bubble.textContent = "Chat";
  shadow.appendChild(bubble);
  document.body.appendChild(host);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
