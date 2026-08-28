import { SessionResponse } from "@platform/shared";

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
}

function renderConnected(data: SessionResponse): void {
  const header = el("header");
  header.textContent = data.branding.displayName;
  header.style.color = data.branding.color;
  el("status").textContent = data.branding.greeting;
  el("root").dataset.state = "connected";
}

function renderUnavailable(): void {
  el("status").textContent = "Chat unavailable";
  el("root").dataset.state = "unavailable";
}

const parentOrigin = new URLSearchParams(location.search).get("parentOrigin");

window.addEventListener("message", (ev) => {
  if (!parentOrigin || ev.origin !== parentOrigin) return;
  if (ev.source !== window.parent) return;
  const data = ev.data;
  if (data?.type !== "platform:session") return;
  const session = data.session;
  if (session?.ok) {
    const parsed = SessionResponse.pick({ branding: true }).safeParse({
      branding: session.branding
    });
    if (parsed.success) {
      renderConnected({
        token: session.token,
        sessionId: "",
        expiresAt: 0,
        branding: parsed.data.branding
      });
      return;
    }
  }
  renderUnavailable();
});

if (parentOrigin && window.parent && window.parent !== window) {
  window.parent.postMessage({ type: "platform:ready" }, parentOrigin);
}
