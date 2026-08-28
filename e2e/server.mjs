import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const widgetDist = resolve(repo, "packages/widget/dist");
const chatDist = resolve(repo, "packages/widget/dist-chat");

const SITE_KEY = "pk_live_devtenant000001";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "http://localhost:4310";

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json"
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "cache-control": "no-store", ...headers });
  res.end(body);
}

function serveFile(res, path) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    send(res, 404, "not found");
    return;
  }
  send(res, 200, readFileSync(path), {
    "content-type": MIME[extname(path)] ?? "application/octet-stream"
  });
}

// Mock API — enforces origin allowlist server-side.
function apiServer(port) {
  createServer((req, res) => {
    const origin = req.headers.origin ?? "";
    if (req.method === "OPTIONS") {
      send(res, 204, "", {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "POST,OPTIONS",
        "access-control-allow-headers": "content-type"
      });
      return;
    }
    if (req.url === "/v1/widget/session" && req.method === "POST") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw || "{}");
        const cors = { "access-control-allow-origin": origin, "content-type": "application/json" };
        if (body.siteKey !== SITE_KEY) {
          send(res, 403, JSON.stringify({ error: { code: "bad_site_key", message: "x" } }), cors);
          return;
        }
        if (origin !== ALLOWED_ORIGIN) {
          send(res, 403, JSON.stringify({ error: { code: "origin_not_allowed", message: "x" } }), cors);
          return;
        }
        send(
          res,
          200,
          JSON.stringify({
            token: "h.p.s",
            sessionId: "01ABCSESSION",
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            branding: { displayName: "Dev Bot", greeting: "Hi there!", color: "#4f46e5" }
          }),
          cors
        );
      });
      return;
    }
    send(res, 404, "not found");
  }).listen(port, () => console.log(`api on ${port}`));
}

// Static server for chat app + widget.js.
function chatServer(port) {
  createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    if (url === "/widget.js") return serveFile(res, join(widgetDist, "widget.js"));
    const path = url === "/" ? join(chatDist, "chat.html") : join(chatDist, url);
    serveFile(res, path);
  }).listen(port, () => console.log(`chat on ${port}`));
}

// Merchant page server — serves a page embedding the widget.
function merchantServer(port) {
  createServer((req, res) => {
    if ((req.url ?? "/").startsWith("/widget.js")) {
      return serveFile(res, join(widgetDist, "widget.js"));
    }
    const html = `<!doctype html><html><head><title>Merchant</title></head>
<body><h1>Merchant Store</h1>
<script src="/widget.js" data-site-key="${SITE_KEY}" data-chat-origin="http://localhost:4320" data-api-base="http://localhost:4300"></script>
</body></html>`;
    send(res, 200, html, { "content-type": "text/html" });
  }).listen(port, () => console.log(`merchant on ${port}`));
}

apiServer(Number(process.env.API_PORT ?? 4300));
chatServer(Number(process.env.CHAT_PORT ?? 4320));
merchantServer(Number(process.env.MERCHANT_PORT ?? 4310));
merchantServer(Number(process.env.FOREIGN_PORT ?? 4311));
