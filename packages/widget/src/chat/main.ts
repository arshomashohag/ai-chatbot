import { SessionResponse, ChatMessageResponse } from "@platform/shared";
import { contrastOk, splitLinks, isSafeApiBase } from "./util.js";

const parentOrigin = new URLSearchParams(location.search).get("parentOrigin");

const ACCENT_FALLBACK = "#6d5ae6";

let token = "";
let apiBase = "";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

// Append a message, linkifying URLs safely (text nodes + anchors, never
// innerHTML of model output, so no XSS).
function appendMessage(role: "user" | "bot", text: string): void {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  for (const seg of splitLinks(text)) {
    if (seg.type === "text") {
      div.appendChild(document.createTextNode(seg.value));
    } else {
      const a = document.createElement("a");
      a.href = seg.value;
      a.textContent = seg.value;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      div.appendChild(a);
    }
  }
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

// Render tenant-provided starter prompts. Renders nothing when there are none
// (no generic hardcoded prompts that would be wrong for the tenant's industry).
function renderSuggested(prompts: string[] | undefined): void {
  if (!prompts || prompts.length === 0) return;
  const log = el("log");
  const wrap = document.createElement("div");
  wrap.id = "suggested";
  const label = document.createElement("div");
  label.className = "label";
  label.textContent = "Suggested";
  wrap.appendChild(label);
  for (const q of prompts) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "suggest";
    const span = document.createElement("span");
    span.textContent = "→";
    b.append(document.createTextNode(q + " "), span);
    b.addEventListener("click", () => {
      wrap.remove();
      if (token) void send(q);
    });
    wrap.appendChild(b);
  }
  log.appendChild(wrap);
}

function renderConnected(branding: SessionResponse["branding"]): void {
  const accent = contrastOk(branding.color) ? branding.color : ACCENT_FALLBACK;
  document.documentElement.style.setProperty("--wa", accent);
  el("header").textContent = branding.displayName;
  el("status").remove();
  appendMessage("bot", branding.greeting);
  renderSuggested(branding.suggestedPrompts);
  el("root").dataset.state = "connected";
  el<HTMLInputElement>("input").focus();
}

function renderUnavailable(): void {
  el("status").textContent = "Chat unavailable";
  el("root").dataset.state = "unavailable";
  // Offer a retry that re-requests a session from the parent instead of leaving
  // the user at a dead end.
  const status = el("status");
  if (!document.getElementById("retry")) {
    const btn = document.createElement("button");
    btn.id = "retry";
    btn.type = "button";
    btn.className = "retry";
    btn.textContent = "Try again";
    btn.addEventListener("click", () => {
      btn.remove();
      status.textContent = "Connecting…";
      el("root").dataset.state = "loading";
      if (parentOrigin) {
        window.parent.postMessage({ type: "platform:ready" }, parentOrigin);
      }
    });
    status.after(btn);
  }
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
      input.value = text; // preserve so the user can resend
      return;
    }
    if (!res.ok) {
      appendMessage("bot", "Sorry, something went wrong. Please try again.");
      input.value = text;
      return;
    }
    const body = await res.json().catch(() => null);
    const parsed = ChatMessageResponse.safeParse(body);
    if (parsed.success) {
      appendMessage("bot", parsed.data.reply);
    } else {
      appendMessage("bot", "Sorry, something went wrong. Please try again.");
      input.value = text;
    }
  } catch {
    typing.remove();
    appendMessage("bot", "Network error. Please try again.");
    input.value = text; // don't lose what the user typed
  } finally {
    button.disabled = false;
    input.focus();
  }
}

function requestClose(): void {
  if (parentOrigin) {
    window.parent.postMessage({ type: "platform:close" }, parentOrigin);
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
    // Only trust an https apiBase. This prevents a page that frames the chat
    // and injects a session from redirecting the bearer token to an
    // attacker-controlled (or downgraded http) endpoint.
    const safeApiBase = isSafeApiBase(data.apiBase) ? String(data.apiBase) : "";
    if (parsed.success && safeApiBase) {
      token = session.token;
      apiBase = safeApiBase;
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

// Close affordances — critical on mobile where the fullscreen iframe hides the
// launcher. The parent (loader) handles platform:close by hiding the frame and
// restoring focus to the launcher.
document.getElementById("close")?.addEventListener("click", requestClose);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") requestClose();
});

if (parentOrigin && window.parent && window.parent !== window) {
  window.parent.postMessage({ type: "platform:ready" }, parentOrigin);
}
