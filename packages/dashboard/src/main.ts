import { signUp, confirm, login, currentToken, logout } from "./auth.js";
import { api } from "./api.js";
import type { KbEntry, SessionSummary } from "@platform/shared";

const app = document.getElementById("app")!;

function h(html: string): void {
  app.innerHTML = html;
}

function val(id: string): string {
  return (document.getElementById(id) as HTMLInputElement).value.trim();
}

async function render(): Promise<void> {
  const token = await currentToken();
  if (token) return renderDashboard();
  renderAuth();
}

function renderAuth(): void {
  h(`
    <h1>Chatbot Portal</h1>
    <section>
      <h2>Sign up</h2>
      <label>Email</label><input id="su-email" data-testid="su-email" />
      <label>Password</label><input id="su-pass" type="password" data-testid="su-pass" />
      <button data-testid="signup">Create account</button>
      <div id="su-msg" class="err"></div>
    </section>
    <section>
      <h2>Verify</h2>
      <label>Email</label><input id="cf-email" data-testid="cf-email" />
      <label>Code</label><input id="cf-code" data-testid="cf-code" />
      <button data-testid="confirm">Confirm</button>
      <div id="cf-msg" class="err"></div>
    </section>
    <section>
      <h2>Log in</h2>
      <label>Email</label><input id="li-email" data-testid="li-email" />
      <label>Password</label><input id="li-pass" type="password" data-testid="li-pass" />
      <button data-testid="login">Log in</button>
      <div id="li-msg" class="err"></div>
    </section>
  `);

  document.querySelector('[data-testid="signup"]')!.addEventListener("click", async () => {
    const m = document.getElementById("su-msg")!;
    try {
      await signUp(val("su-email"), val("su-pass"));
      m.className = "ok";
      m.textContent = "Check your email for a verification code.";
    } catch (e) {
      m.textContent = (e as Error).message;
    }
  });
  document.querySelector('[data-testid="confirm"]')!.addEventListener("click", async () => {
    const m = document.getElementById("cf-msg")!;
    try {
      await confirm(val("cf-email"), val("cf-code"));
      m.className = "ok";
      m.textContent = "Verified. You can log in now.";
    } catch (e) {
      m.textContent = (e as Error).message;
    }
  });
  document.querySelector('[data-testid="login"]')!.addEventListener("click", async () => {
    const m = document.getElementById("li-msg")!;
    try {
      await login(val("li-email"), val("li-pass"));
      render();
    } catch (e) {
      m.textContent = (e as Error).message;
    }
  });
}

async function renderDashboard(): Promise<void> {
  const [cfg, kb, sessions] = await Promise.all([
    api.getConfig(),
    api.listKb(),
    api.listSessions().catch(() => [] as SessionSummary[])
  ]);

  h(`
    <h1>Setup</h1>
    <button class="secondary" data-testid="logout">Log out</button>

    <section>
      <h2>1. Business basics</h2>
      <label>Business name</label><input id="b-name" data-testid="b-name" value="${cfg.basics?.name ?? ""}" />
      <label>Website URL</label><input id="b-url" data-testid="b-url" value="${cfg.basics?.websiteUrl ?? ""}" />
      <label>Allowed domain (one URL)</label><input id="b-dom" data-testid="b-dom" value="${cfg.basics?.allowedDomains?.[0] ?? ""}" />
      <button data-testid="save-basics">Save basics</button>
    </section>

    <section>
      <h2>2. Appearance</h2>
      <label>Display name</label><input id="a-name" data-testid="a-name" value="${cfg.appearance?.displayName ?? "Assistant"}" />
      <label>Greeting</label><input id="a-greet" data-testid="a-greet" value="${cfg.appearance?.greeting ?? "Hi! How can I help?"}" />
      <label>Color</label><input id="a-color" data-testid="a-color" value="${cfg.appearance?.color ?? "#4f46e5"}" />
      <label>Tone</label>
      <select id="a-tone" data-testid="a-tone">
        <option value="friendly">friendly</option>
        <option value="professional">professional</option>
        <option value="playful">playful</option>
      </select>
      <button data-testid="save-appearance">Save appearance</button>
    </section>

    <section>
      <h2>3. Knowledge</h2>
      <label>Business profile</label>
      <textarea id="k-profile" data-testid="k-profile" rows="3">${cfg.businessProfile ?? ""}</textarea>
      <button data-testid="save-profile">Save profile</button>
      <label>Add FAQ — title</label><input id="k-title" data-testid="k-title" />
      <label>FAQ — answer</label><textarea id="k-body" data-testid="k-body" rows="2"></textarea>
      <button data-testid="add-kb">Add FAQ</button>
      <div id="kb-list">${kb.map(kbRow).join("")}</div>
    </section>

    <section>
      <h2>4. Get your key</h2>
      <button data-testid="issue-key">Get my key</button>
      <div id="key-out"></div>
    </section>

    <section>
      <h2>Sessions</h2>
      <div id="sess-list">${sessions.map(sessRow).join("")}</div>
      <div id="transcript"></div>
    </section>
  `);

  wireDashboard();
}

function kbRow(e: KbEntry): string {
  return `<div class="kb-item" data-testid="kb-item">${escapeHtml(e.title)}
    <button class="secondary" data-del="${e.id}">delete</button></div>`;
}

function sessRow(s: SessionSummary): string {
  return `<div class="sess-item"><button class="secondary" data-sess="${s.sessionId}" data-testid="sess-open">
    ${escapeHtml(s.origin || s.sessionId)} (${s.messageCount} msgs)</button></div>`;
}

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function wireDashboard(): void {
  document.querySelector('[data-testid="logout"]')!.addEventListener("click", () => {
    logout();
    render();
  });
  document.querySelector('[data-testid="save-basics"]')!.addEventListener("click", () =>
    api.saveBasics({
      name: val("b-name"),
      websiteUrl: val("b-url"),
      allowedDomains: [val("b-dom")]
    }).then(() => flash("save-basics", "Saved"))
  );
  document.querySelector('[data-testid="save-appearance"]')!.addEventListener("click", () =>
    api.saveAppearance({
      displayName: val("a-name"),
      greeting: val("a-greet"),
      color: val("a-color"),
      tone: (document.getElementById("a-tone") as HTMLSelectElement).value as never
    }).then(() => flash("save-appearance", "Saved"))
  );
  document.querySelector('[data-testid="save-profile"]')!.addEventListener("click", () =>
    api.saveProfile(val("k-profile")).then(() => flash("save-profile", "Saved"))
  );
  document.querySelector('[data-testid="add-kb"]')!.addEventListener("click", async () => {
    await api.addKb({
      type: "faq",
      title: val("k-title"),
      body: val("k-body"),
      enabled: true
    });
    renderDashboard();
  });
  document.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      await api.deleteKb((b as HTMLElement).dataset.del!);
      renderDashboard();
    })
  );
  document.querySelector('[data-testid="issue-key"]')!.addEventListener("click", async () => {
    const out = document.getElementById("key-out")!;
    try {
      const r = await api.issueKey();
      out.innerHTML = `<p class="ok">Copy this now — it is shown only once.</p>
        <pre data-testid="site-key">${escapeHtml(r.siteKey)}</pre>
        <label>Embed snippet</label><pre data-testid="snippet">${escapeHtml(r.snippet)}</pre>`;
    } catch (e) {
      out.innerHTML = `<p class="err" data-testid="key-error">${escapeHtml((e as Error).message)}</p>`;
    }
  });
  document.querySelectorAll('[data-testid="sess-open"]').forEach((b) =>
    b.addEventListener("click", async () => {
      const id = (b as HTMLElement).dataset.sess!;
      const t = await api.transcript(id);
      document.getElementById("transcript")!.innerHTML = `<h3>Transcript</h3>` +
        t.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map(
            (m) =>
              `<div class="msg ${m.role}" data-testid="transcript-msg">${escapeHtml(m.content)}</div>`
          )
          .join("");
    })
  );
}

function flash(testid: string, msg: string): void {
  const btn = document.querySelector(`[data-testid="${testid}"]`)!;
  const span = document.createElement("span");
  span.className = "ok";
  span.textContent = ` ${msg}`;
  btn.after(span);
  setTimeout(() => span.remove(), 1500);
}

void render();
