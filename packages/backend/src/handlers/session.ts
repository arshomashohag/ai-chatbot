import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ulid } from "../lib/ulid.js";
import {
  SessionRequest,
  SessionResponse,
  WIDGET_ERROR_CODES,
  MAX_SESSION_TTL_SECONDS,
  JWT_ISS,
  JWT_AUD,
  type WidgetClaims
} from "@platform/shared";
import { hashSiteKey } from "@platform/shared/node";
import { json, error } from "../lib/http.js";
import { findTenantBySiteKeyHash, putSession } from "../lib/ddb.js";
import { listKb } from "../lib/admin-ddb.js";
import { matchAllowedOrigin, normalizeOrigin } from "../lib/origin.js";
import { signWidgetJwt } from "../lib/jwt.js";

function corsHeaders(origin: string): Record<string, string> {
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    vary: "Origin"
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const origin = event.headers?.origin ?? event.headers?.Origin ?? "";
  // Reflect the (normalized) request origin on EVERY response — including the
  // 400/403 error paths and the OPTIONS preflight — so the embedding site's
  // browser can actually read the response instead of seeing an opaque CORS
  // failure. Reflecting only a well-formed origin (not a raw header) keeps this
  // from echoing arbitrary/injected values. The security allowlisting still
  // happens below via matchAllowedOrigin; CORS only governs readability.
  const reflect = normalizeOrigin(origin) ?? "";
  const cors = corsHeaders(reflect);

  // Preflight: the browser sends OPTIONS with no body before the POST. Answer
  // it directly — running the full handler on OPTIONS would 400 on the empty
  // body and (previously) drop CORS, which is exactly what blocked the widget.
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return error(400, WIDGET_ERROR_CODES.INVALID_REQUEST, "Malformed body", cors);
  }
  const parsed = SessionRequest.safeParse(body);
  if (!parsed.success) {
    return error(400, WIDGET_ERROR_CODES.INVALID_REQUEST, "Invalid request", cors);
  }

  const tenant = await findTenantBySiteKeyHash(
    hashSiteKey(parsed.data.siteKey)
  );
  if (!tenant) {
    return error(403, WIDGET_ERROR_CODES.BAD_SITE_KEY, "Unknown site key", cors);
  }
  if (tenant.status === "suspended") {
    return error(
      403,
      WIDGET_ERROR_CODES.TENANT_SUSPENDED,
      "Tenant unavailable",
      cors
    );
  }
  const matchedOrigin = matchAllowedOrigin(origin, tenant.allowedOrigins);
  if (!matchedOrigin) {
    return error(
      403,
      WIDGET_ERROR_CODES.ORIGIN_NOT_ALLOWED,
      "Origin not allowed",
      cors
    );
  }

  const keyId = process.env.JWT_KMS_KEY_ID;
  if (!keyId) throw new Error("JWT_KMS_KEY_ID env var is required");

  const now = Math.floor(Date.now() / 1000);
  const exp = now + MAX_SESSION_TTL_SECONDS;
  const sessionId = ulid();
  const claims: WidgetClaims = {
    tenant_id: tenant.tenantId,
    session_id: sessionId,
    origin: matchedOrigin,
    iss: JWT_ISS,
    aud: JWT_AUD,
    iat: now,
    exp
  };

  const token = await signWidgetJwt(claims, keyId);

  await putSession({
    tenantId: tenant.tenantId,
    sessionId,
    origin: matchedOrigin,
    userAgent: event.headers?.["user-agent"] ?? "",
    createdAt: now,
    ttl: exp
  });

  // Seed up to 3 suggested prompts from the tenant's enabled KB titles so the
  // widget shows relevant starters instead of generic hardcoded ones. Best
  // effort — a KB read failure must not fail session creation.
  let suggestedPrompts: string[] | undefined;
  try {
    const kb = await listKb(tenant.tenantId);
    const titles = kb
      .filter((e) => e.enabled && typeof e.title === "string" && e.title.trim())
      .map((e) => e.title.trim())
      .slice(0, 3);
    if (titles.length) suggestedPrompts = titles;
  } catch {
    suggestedPrompts = undefined;
  }

  const res: SessionResponse = {
    token,
    sessionId,
    expiresAt: exp,
    branding: { ...tenant.branding, suggestedPrompts }
  };
  return json(200, SessionResponse.parse(res), corsHeaders(matchedOrigin));
};
