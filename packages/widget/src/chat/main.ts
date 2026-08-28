import { SessionResponse, ChatMessageResponse } from "@platform/shared";

const parentOrigin = new URLSearchParams(location.search).get("parentOrigin");

let token = "";
let apiBase = "";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

function appendMessage(role: "user" | "bot", text: string): void {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  const log = el("log");
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function renderConnected(branding: SessionResponse["branding"]): void {
  const header = el("header");
  header.textContent = branding.displayName;
  header.style.color = branding.color;
  el("status").textContent = branding.greeting;
  el("root").dataset.state = "connected";
}

function renderUnavailable(): void {
  el("status").textContent = "Chat unavailable";
  el("root").dataset.state = "unavailable";
}

async function send(text: string): Promise<void> {
  const input = el<HTMLInputElement>("input");
  const button = el<HTMLButtonElement>("send");
  input.value = "";
  button.disabled = true;
  appendMessage("user", text);
  el("status").textContent = "…";
  try {
    const res = await fetch(`${apiBase}/v1/chat/message`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ message: text })
    });
    const body = await res.json().catch(() => null);
    const parsed = ChatMessageResponse.safeParse(body);
    appendMessage(
      "bot",
      parsed.success ? parsed.data.reply : "Sorry, something went wrong."
    );
  } catch {
    appendMessage("bot", "Network error. Please try again.");
  } finally {
    el("status").textContent = "";
    button.disabled = false;
    input.focus();
  }
}

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
      token = session.token;
      apiBase = data.apiBase ?? "";
      renderConnected(parsed.data.branding);
      return;
    }
  }
  renderUnavailable();
});

el<HTMLFormElement>("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const value = el<HTMLInputElement>("input").value.trim();
  if (value && token) void send(value);
});

if (parentOrigin && window.parent && window.parent !== window) {
  window.parent.postMessage({ type: "platform:ready" }, parentOrigin);
}
