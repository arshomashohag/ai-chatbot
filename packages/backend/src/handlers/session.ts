import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { ulid } from "ulid";
import {
  SessionRequest,
  SessionResponse,
  WIDGET_ERROR_CODES,
  MAX_SESSION_TTL_SECONDS,
  type WidgetClaims
} from "@platform/shared";
import { hashSiteKey } from "@platform/shared/node";
import { json, error } from "../lib/http.js";
import { findTenantBySiteKeyHash, putSession } from "../lib/ddb.js";
import { matchAllowedOrigin } from "../lib/origin.js";
import { signWidgetJwt } from "../lib/jwt.js";

function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin"
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const origin = event.headers?.origin ?? event.headers?.Origin ?? "";

  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return error(400, WIDGET_ERROR_CODES.INVALID_REQUEST, "Malformed body");
  }
  const parsed = SessionRequest.safeParse(body);
  if (!parsed.success) {
    return error(400, WIDGET_ERROR_CODES.INVALID_REQUEST, "Invalid request");
  }

  const tenant = await findTenantBySiteKeyHash(
    hashSiteKey(parsed.data.siteKey)
  );
  if (!tenant) {
    return error(403, WIDGET_ERROR_CODES.BAD_SITE_KEY, "Unknown site key");
  }
  if (tenant.status === "suspended") {
    return error(
      403,
      WIDGET_ERROR_CODES.TENANT_SUSPENDED,
      "Tenant unavailable"
    );
  }
  const matchedOrigin = matchAllowedOrigin(origin, tenant.allowedOrigins);
  if (!matchedOrigin) {
    return error(
      403,
      WIDGET_ERROR_CODES.ORIGIN_NOT_ALLOWED,
      "Origin not allowed"
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

  const res: SessionResponse = {
    token,
    sessionId,
    expiresAt: exp,
    branding: tenant.branding
  };
  return json(200, SessionResponse.parse(res), corsHeaders(matchedOrigin));
};
