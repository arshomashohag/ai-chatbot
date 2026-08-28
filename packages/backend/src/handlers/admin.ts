import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from "aws-lambda";
import {
  BusinessBasics,
  Appearance,
  KbEntryInput,
  IssueKeyResponse,
  type AdminConfig
} from "@platform/shared";
import { generateSiteKey } from "@platform/shared/node";
import { json, error } from "../lib/http.js";
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
  getTranscript
} from "../lib/admin-ddb.js";

const GRACE_SECONDS = 24 * 60 * 60;

function snippet(siteKey: string, cdnOrigin: string): string {
  return `<script src="https://${cdnOrigin}/widget.js" data-site-key="${siteKey}" data-chat-origin="https://${cdnOrigin.replace("cdn.", "chat.")}" data-api-base="https://${cdnOrigin.replace("cdn.", "api-" + (process.env.ENV ?? "dev") + ".")}"></script>`;
}

async function computeSetupComplete(tenantId: string): Promise<boolean> {
  const cfg = await getConfig(tenantId);
  const kb = await listKb(tenantId);
  const hasDomain = (cfg.basics?.allowedDomains?.length ?? 0) >= 1;
  const hasProfile = Boolean(cfg.businessProfile?.trim());
  const hasKb = kb.length >= 1;
  return hasDomain && hasProfile && hasKb;
}

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = async (
  event
) => {
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
  const body = event.body ? JSON.parse(event.body) : {};

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
    if (typeof body.businessProfile !== "string") {
      return error(400, "invalid_request", "Invalid profile");
    }
    await saveBusinessProfile(tenantId, body.businessProfile.slice(0, 4000));
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
    const cdnOrigin = process.env.CDN_ORIGIN ?? "cdn.example.com";
    const res: IssueKeyResponse = {
      siteKey: plaintext,
      snippet: snippet(plaintext, cdnOrigin)
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
