import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const widgetDist = resolve(repo, "packages/widget/dist");
const chatDist = resolve(repo, "packages/widget/dist-chat");
const portalDist = resolve(repo, "packages/dashboard/dist");

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json"
};

// Single in-memory tenant, keyed by the E2E token.
const tenant = {
  basics: null,
  appearance: null,
  businessProfile: "",
  kb: [],
  siteKeyHash: null
};
let issuedPlaintext = null;

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "cache-control": "no-store", ...headers });
  res.end(body);
}
function jsonRes(res, status, obj, origin) {
  send(res, status, JSON.stringify(obj), {
    "content-type": "application/json",
    "access-control-allow-origin": origin ?? "*"
  });
}
function readBody(req) {
  return new Promise((r) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => r(s ? JSON.parse(s) : {}));
  });
}
function serveFile(res, path) {
  if (!existsSync(path) || !statSync(path).isFile()) return send(res, 404, "nf");
  send(res, 200, readFileSync(path), {
    "content-type": MIME[extname(path)] ?? "application/octet-stream"
  });
}
function setupComplete() {
  return (
    (tenant.basics?.allowedDomains?.length ?? 0) >= 1 &&
    Boolean(tenant.businessProfile.trim()) &&
    tenant.kb.length >= 1
  );
}

async function api(req, res) {
  const origin = req.headers.origin ?? "*";
  if (req.method === "OPTIONS") {
    return send(res, 204, "", {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type,authorization"
    });
  }
  const url = (req.url ?? "").split("?")[0];
  const body = req.method === "GET" ? {} : await readBody(req);

  if (url === "/v1/admin/config")
    return jsonRes(res, 200, {
      businessProfile: tenant.businessProfile,
      appearance: tenant.appearance ?? undefined,
      basics: tenant.basics ?? undefined,
      setupComplete: setupComplete(),
      hasKey: Boolean(tenant.siteKeyHash)
    }, origin);
  if (url === "/v1/admin/basics") {
    tenant.basics = body;
    return jsonRes(res, 200, { ok: true }, origin);
  }
  if (url === "/v1/admin/appearance") {
    tenant.appearance = body;
    return jsonRes(res, 200, { ok: true }, origin);
  }
  if (url === "/v1/admin/profile") {
    tenant.businessProfile = body.businessProfile ?? "";
    return jsonRes(res, 200, { ok: true }, origin);
  }
  if (url === "/v1/admin/kb" && req.method === "GET")
    return jsonRes(res, 200, { entries: tenant.kb }, origin);
  if (url === "/v1/admin/kb" && req.method === "POST") {
    const entry = { id: randomBytes(6).toString("hex"), ...body };
    tenant.kb.push(entry);
    return jsonRes(res, 200, entry, origin);
  }
  if (url.startsWith("/v1/admin/kb/") && req.method === "DELETE") {
    const id = url.split("/v1/admin/kb/")[1];
    tenant.kb = tenant.kb.filter((e) => e.id !== id);
    return jsonRes(res, 200, { ok: true }, origin);
  }
  if (url === "/v1/admin/key") {
    if (!setupComplete())
      return jsonRes(
        res,
        400,
        { error: { code: "setup_incomplete", message: "incomplete" } },
        origin
      );
    issuedPlaintext = `pk_live_${randomBytes(24).toString("hex")}`;
    tenant.siteKeyHash = createHash("sha256").update(issuedPlaintext).digest("hex");
    const cdn = "localhost:4520";
    return jsonRes(
      res,
      200,
      {
        siteKey: issuedPlaintext,
        snippet: `<script src="http://${cdn}/widget.js" data-site-key="${issuedPlaintext}"></script>`
      },
      origin
    );
  }
  if (url.startsWith("/v1/admin/sessions/"))
    return jsonRes(res, 200, { sessionId: "s1", messages: SESSIONS.transcript }, origin);
  if (url === "/v1/admin/sessions")
    return jsonRes(res, 200, { sessions: SESSIONS.list }, origin);

  // Widget session handshake — validates the issued key + records a session.
  if (url === "/v1/widget/session" && req.method === "POST") {
    const hash = createHash("sha256").update(body.siteKey ?? "").digest("hex");
    if (!tenant.siteKeyHash || hash !== tenant.siteKeyHash)
      return jsonRes(res, 403, { error: { code: "bad_site_key", message: "x" } }, origin);
    return jsonRes(
      res,
      200,
      {
        token: "widget.jwt.token",
        sessionId: "s1",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        branding: {
          displayName: tenant.appearance?.displayName ?? "Assistant",
          greeting: tenant.appearance?.greeting ?? "Hi!",
          color: tenant.appearance?.color ?? "#4f46e5"
        }
      },
      origin
    );
  }

  // Chat — grounds the reply on a matching FAQ from the tenant's KB.
  if (url === "/v1/chat/message" && req.method === "POST") {
    const q = (body.message ?? "").toLowerCase();
    const hit = tenant.kb.find((e) =>
      q.split(/\s+/).some((w) => w.length > 3 && e.body.toLowerCase().includes(w))
    );
    const reply = hit ? hit.body : "I don't have information on that.";
    SESSIONS.transcript.push({ role: "user", content: body.message });
    SESSIONS.transcript.push({ role: "assistant", content: reply });
    SESSIONS.list[0].messageCount = SESSIONS.transcript.length;
    return jsonRes(res, 200, { reply, sessionId: "s1" }, origin);
  }

  send(res, 404, "nf");
}

const SESSIONS = {
  list: [{ sessionId: "s1", origin: "http://localhost:4510", createdAt: 1, messageCount: 0 }],
  transcript: []
};

// API server
createServer((req, res) => api(req, res)).listen(4500, () => console.log("api 4500"));

// Portal SPA server (fallback to index.html)
createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  const path = url === "/" ? join(portalDist, "index.html") : join(portalDist, url);
  if (existsSync(path) && statSync(path).isFile()) return serveFile(res, path);
  serveFile(res, join(portalDist, "index.html"));
}).listen(4510, () => console.log("portal 4510"));

// Widget + chat host
createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  if (url === "/widget.js") return serveFile(res, join(widgetDist, "widget.js"));
  const path = url === "/" ? join(chatDist, "chat.html") : join(chatDist, url);
  serveFile(res, path);
}).listen(4520, () => console.log("cdn/chat 4520"));

// Merchant page embedding the (issued) key — served AFTER key issuance in test
createServer((req, res) => {
  if ((req.url ?? "/").startsWith("/widget.js"))
    return serveFile(res, join(widgetDist, "widget.js"));
  const key = issuedPlaintext ?? "";
  send(
    res,
    200,
    `<!doctype html><html><body><h1>Merchant</h1>
<script src="/widget.js" data-site-key="${key}" data-chat-origin="http://localhost:4520" data-api-base="http://localhost:4500"></script>
</body></html>`,
    { "content-type": "text/html" }
  );
}).listen(4510 + 1, () => console.log("merchant 4511"));
