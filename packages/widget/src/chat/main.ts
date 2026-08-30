import { SessionResponse, ChatMessageResponse } from "@platform/shared";
import {
  contrastOk,
  splitLinks,
  isSafeApiBase,
  parseMarkdown,
  type Inline,
  type Block
} from "./util.js";

const parentOrigin = new URLSearchParams(location.search).get("parentOrigin");

const ACCENT_FALLBACK = "#6d5ae6";

let token = "";
let apiBase = "";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

// Build a safe anchor for a URL (never innerHTML of model text → no XSS).
function linkEl(url: string): HTMLAnchorElement {
  const a = document.createElement("a");
  a.href = url;
  a.textContent = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}

// Render inline segments (bold/italic/code/link/text) into a parent node.
function appendInlines(parent: Node, inlines: Inline[]): void {
  for (const seg of inlines) {
    if (seg.type === "link") {
      parent.appendChild(linkEl(seg.value));
    } else if (seg.type === "bold") {
      const s = document.createElement("strong");
      s.textContent = seg.value;
      parent.appendChild(s);
    } else if (seg.type === "italic") {
      const em = document.createElement("em");
      em.textContent = seg.value;
      parent.appendChild(em);
    } else if (seg.type === "code") {
      const c = document.createElement("code");
      c.textContent = seg.value;
      parent.appendChild(c);
    } else {
      parent.appendChild(document.createTextNode(seg.value));
    }
  }
}

// Render a parsed Markdown block tree into a container, building every node
// programmatically so model output is never passed through innerHTML.
function appendBlocks(parent: Node, blocks: Block[]): void {
  for (const block of blocks) {
    if (block.type === "heading") {
      const h = document.createElement(`h${block.level}`);
      appendInlines(h, block.inlines);
      parent.appendChild(h);
    } else if (block.type === "list") {
      const list = document.createElement(block.ordered ? "ol" : "ul");
      for (const item of block.items) {
        const li = document.createElement("li");
        appendInlines(li, item);
        list.appendChild(li);
      }
      parent.appendChild(list);
    } else {
      const p = document.createElement("p");
      appendInlines(p, block.inlines);
      parent.appendChild(p);
    }
  }
}

// Append a message. Bot replies are Markdown — parsed and rendered as formatted
// DOM (bold/italic/code/headings/lists/links), never as innerHTML of the raw
// text, so `**`/`#`/`` ` `` show as formatting instead of literal characters
// with no XSS risk. User messages stay plain text + safe link handling.
function appendMessage(role: "user" | "bot", text: string): void {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  if (role === "bot") {
    appendBlocks(div, parseMarkdown(text));
  } else {
    for (const seg of splitLinks(text)) {
      div.appendChild(
        seg.type === "link" ? linkEl(seg.value) : document.createTextNode(seg.value)
      );
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
