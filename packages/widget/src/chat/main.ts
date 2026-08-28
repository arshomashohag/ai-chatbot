import { SessionResponse, ChatMessageResponse } from "@platform/shared";

const parentOrigin = new URLSearchParams(location.search).get("parentOrigin");

let token = "";
let apiBase = "";

const SUGGESTED = [
  "Where is my order?",
  "Do you have this in stock?",
  "What's your return policy?"
];

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

function showTyping(): HTMLElement {
  const div = document.createElement("div");
  div.className = "typing";
  div.setAttribute("aria-label", "Assistant is typing");
  div.innerHTML = "<span></span><span></span><span></span>";
  const log = el("log");
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

function renderSuggested(): void {
  const log = el("log");
  const wrap = document.createElement("div");
  wrap.id = "suggested";
  const label = document.createElement("div");
  label.className = "label";
  label.textContent = "Suggested";
  wrap.appendChild(label);
  for (const q of SUGGESTED) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "suggest";
    b.innerHTML = `${q} <span>→</span>`;
    b.addEventListener("click", () => {
      wrap.remove();
      if (token) void send(q);
    });
    wrap.appendChild(b);
  }
  log.appendChild(wrap);
}

function renderConnected(branding: SessionResponse["branding"]): void {
  document.documentElement.style.setProperty("--wa", branding.color);
  el("header").textContent = branding.displayName;
  el("status").remove();
  appendMessage("bot", branding.greeting);
  renderSuggested();
  el("root").dataset.state = "connected";
  el<HTMLInputElement>("input").focus();
}

function renderUnavailable(): void {
  el("status").textContent = "Chat unavailable";
  el("root").dataset.state = "unavailable";
}

async function send(text: string): Promise<void> {
  document.getElementById("suggested")?.remove();
  const input = el<HTMLInputElement>("input");
  const button = el<HTMLButtonElement>("send");
  input.value = "";
  button.disabled = true;
  appendMessage("user", text);
  const typing = showTyping();
  try {
    const res = await fetch(`${apiBase}/v1/chat/message`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ message: text })
    });
    typing.remove();
    if (res.status === 429) {
      appendMessage(
        "bot",
        "You're sending messages too quickly. Please wait a moment."
      );
      return;
    }
    const body = await res.json().catch(() => null);
    const parsed = ChatMessageResponse.safeParse(body);
    appendMessage(
      "bot",
      parsed.success ? parsed.data.reply : "Sorry, something went wrong."
    );
  } catch {
    typing.remove();
    appendMessage("bot", "Network error. Please try again.");
  } finally {
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
