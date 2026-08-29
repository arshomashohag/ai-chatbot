import type {
  APIGatewayProxyHandlerV2WithJWTAuthorizer,
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2
} from "aws-lambda";
import {
  BusinessBasics,
  Appearance,
  KbEntryInput,
  ProfileInput,
  IssueKeyResponse,
  type AdminConfig
} from "@platform/shared";
import { generateSiteKey } from "@platform/shared/node";
import { json, error } from "../lib/http.js";
import { normalizeOrigin } from "../lib/origin.js";
import { tenantForCaller, AdminAuthError } from "../lib/admin-auth.js";
import {
  getConfig,
  saveBasics,
  saveAppearance,
  saveBusinessProfile,
  listKb,
  addKb,
  deleteKb,
  issueSiteKey,
  listSessions,
  getTranscript,
  getUsageSummary
} from "../lib/admin-ddb.js";

const GRACE_SECONDS = 24 * 60 * 60;

function snippet(siteKey: string): string {
  const cdn = process.env.CDN_ORIGIN ?? "chatbot-cdn-dev.example.com";
  const chat = process.env.CHAT_ORIGIN ?? "chatbot-chat-dev.example.com";
  const api = process.env.API_ORIGIN ?? "chatbot-api-dev.example.com";
  // `crossorigin` so an SRI `integrity` attribute can be added later without a
  // snippet-format change. Full SRI is deferred: it needs a versioned widget
  // filename (widget.js is mutable and the hash would change every release,
  // and this snippet is generated server-side, decoupled from the widget build).
  return (
    `<script src="https://${cdn}/widget.js" ` +
    `data-site-key="${siteKey}" ` +
    `data-chat-origin="https://${chat}" ` +
    `data-api-base="https://${api}" ` +
    `crossorigin="anonymous"></script>`
  );
}

async function computeSetupComplete(tenantId: string): Promise<boolean> {
  const cfg = await getConfig(tenantId);
  const kb = await listKb(tenantId);
  const hasDomain = (cfg.basics?.allowedDomains?.length ?? 0) >= 1;
  const hasProfile = Boolean(cfg.businessProfile?.trim());
  const hasKb = kb.length >= 1;
  return hasDomain && hasProfile && hasKb;
}

// The portal is served from a different subdomain than the API, so admin
// responses need CORS. Reflect only our own portal origin (never the raw
// request Origin) so this authenticated API isn't opened to arbitrary sites.
function adminCors(requestOrigin: string | undefined): Record<string, string> {
  const portal = process.env.PORTAL_ORIGIN
    ? `https://${process.env.PORTAL_ORIGIN}`
    : "";
  const normalized = normalizeOrigin(requestOrigin);
  if (!portal || normalized !== normalizeOrigin(portal)) return {};
  return {
    "access-control-allow-origin": portal,
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "600",
    vary: "Origin"
  };
}

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (
  event
) => {
  const cors = adminCors(event.headers?.origin ?? event.headers?.Origin);
  const res = await route(event);
  // Add CORS to every response without touching the 21 call sites.
  return { ...res, headers: { ...res.headers, ...cors } };
};

async function route(
  event: APIGatewayProxyEventV2WithJWTAuthorizer
): Promise<APIGatewayProxyStructuredResultV2> {
  // CORS preflight is unauthenticated (browsers send OPTIONS without the JWT).
  if (event.requestContext.http.method === "OPTIONS") {
    return { statusCode: 204, body: "" };
  }

  let tenantId: string;
  try {
    tenantId = await tenantForCaller(event);
  } catch (e) {
    if (e instanceof AdminAuthError) {
      return error(403, "forbidden", "Not authorized");
    }
    throw e;
  }

  const method = event.requestContext.http.method;
  const path = event.rawPath.replace(/\/+$/, "");
  let body: unknown;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return error(400, "invalid_request", "Malformed body");
  }

  if (method === "GET" && path.endsWith("/v1/admin/config")) {
    const cfg = await getConfig(tenantId);
    const res: AdminConfig = {
      businessProfile: cfg.businessProfile,
      appearance: cfg.appearance,
      basics: cfg.basics,
      setupComplete: await computeSetupComplete(tenantId),
      hasKey: cfg.hasKey
    };
    return json(200, res);
  }

  if (method === "GET" && path.endsWith("/v1/admin/usage")) {
    const month = new Date().toISOString().slice(0, 7);
    return json(200, await getUsageSummary(tenantId, month));
  }

  if (method === "PUT" && path.endsWith("/v1/admin/basics")) {
    const parsed = BusinessBasics.safeParse(body);
    if (!parsed.success) return error(400, "invalid_request", "Invalid basics");
    await saveBasics(tenantId, parsed.data);
    return json(200, { ok: true });
  }

  if (method === "PUT" && path.endsWith("/v1/admin/appearance")) {
    const parsed = Appearance.safeParse(body);
    if (!parsed.success) return error(400, "invalid_request", "Invalid appearance");
    await saveAppearance(tenantId, parsed.data);
    return json(200, { ok: true });
  }

  if (method === "PUT" && path.endsWith("/v1/admin/profile")) {
    const parsed = ProfileInput.safeParse(body);
    if (!parsed.success) return error(400, "invalid_request", "Invalid profile");
    await saveBusinessProfile(tenantId, parsed.data.businessProfile);
    return json(200, { ok: true });
  }

  if (path.endsWith("/v1/admin/kb")) {
    if (method === "GET") return json(200, { entries: await listKb(tenantId) });
    if (method === "POST") {
      const parsed = KbEntryInput.safeParse(body);
      if (!parsed.success) return error(400, "invalid_request", "Invalid entry");
      try {
        const entry = await addKb(tenantId, parsed.data);
        return json(200, entry);
      } catch {
        return error(409, "kb_limit", "Knowledge base is full");
      }
    }
  }

  if (method === "DELETE" && path.includes("/v1/admin/kb/")) {
    const id = decodeURIComponent(path.split("/v1/admin/kb/")[1] ?? "");
    if (!id) return error(400, "invalid_request", "Missing entry id");
    await deleteKb(tenantId, id);
    return json(200, { ok: true });
  }

  if (method === "POST" && path.endsWith("/v1/admin/key")) {
    if (!(await computeSetupComplete(tenantId))) {
      return error(
        400,
        "setup_incomplete",
        "Add at least one domain, a business profile, and one knowledge entry first."
      );
    }
    const plaintext = generateSiteKey();
    await issueSiteKey(tenantId, plaintext, GRACE_SECONDS);
    const res: IssueKeyResponse = {
      siteKey: plaintext,
      snippet: snippet(plaintext)
    };
    return json(200, res);
  }

  if (method === "GET" && path.includes("/v1/admin/sessions/")) {
    const sessionId = decodeURIComponent(
      path.split("/v1/admin/sessions/")[1] ?? ""
    );
    if (!sessionId) return error(400, "invalid_request", "Missing session id");
    const transcript = await getTranscript(tenantId, sessionId);
    return json(200, { sessionId, messages: transcript });
  }

  if (method === "GET" && path.endsWith("/v1/admin/sessions")) {
    return json(200, { sessions: await listSessions(tenantId) });
  }

  return error(404, "not_found", "Unknown route");
};
