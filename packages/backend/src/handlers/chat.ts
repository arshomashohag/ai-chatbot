import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import {
  ChatMessageRequest,
  ChatMessageResponse
} from "@platform/shared";
import { json, error } from "../lib/http.js";
import { verifyWidgetJwt, JwtError } from "../lib/jwt-verify.js";
import { cachedTenantConfig, evictTenantConfig } from "../lib/config-cache.js";
import {
  queryHistory,
  persistMessages,
  incrementUsage,
  getUsage,
  tripKillSwitch,
  DEFAULT_MONTHLY_MESSAGE_LIMIT
} from "../lib/ddb.js";
import { AnthropicAdapter } from "../lib/adapter/anthropic.js";
import { modelApiKey } from "../lib/secrets.js";
import { runChat } from "../lib/chat-engine.js";
import {
  allowFailOpen,
  SESSION_LIMIT,
  TENANT_LIMIT
} from "../lib/rate-limit.js";
import { listKb } from "../lib/admin-ddb.js";
import { assembleSystemPrompt } from "../lib/prompt-assembly.js";
import { normalizeOrigin } from "../lib/origin.js";
import { tenantPk } from "@platform/shared";

const FRIENDLY_DEGRADE =
  "Sorry, I'm having trouble right now. Please try again in a moment.";

const OVER_QUOTA_REPLY =
  "This assistant has reached its message limit for now. Please check back later.";

/** Effective monthly limit: tenant override if positive, else the platform default. */
function effectiveLimit(configured: number | undefined): number {
  return configured && configured > 0
    ? configured
    : DEFAULT_MONTHLY_MESSAGE_LIMIT;
}

function bearer(event: { headers?: Record<string, string | undefined> }) {
  const raw =
    event.headers?.authorization ?? event.headers?.Authorization ?? "";
  return raw.startsWith("Bearer ") ? raw.slice(7) : "";
}

// CORS for the cross-origin widget. Reflect ONLY a normalized/validated origin,
// never the raw Origin header (no header-injection / wildcard-with-credentials).
function widgetCors(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    vary: "Origin"
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const keyId = process.env.JWT_KMS_KEY_ID;
  if (!keyId) throw new Error("JWT_KMS_KEY_ID is required");

  // The widget is cross-origin; every response needs CORS so the browser can
  // read it (previously absent, so error bodies were opaque — finding 2.6).
  const reflectOrigin = normalizeOrigin(
    event.headers?.origin ?? event.headers?.Origin
  );
  const cors = widgetCors(reflectOrigin);

  // Preflight.
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }

  const token = bearer(event);
  let claims;
  try {
    claims = await verifyWidgetJwt(token, keyId);
  } catch (e) {
    if (e instanceof JwtError) {
      return error(401, "unauthorized", "Invalid or expired session", cors);
    }
    throw e;
  }

  // Origin binding note: the chat POST is issued from inside the chat iframe,
  // whose document origin is the chat CDN — NOT the merchant page. So the
  // request Origin is always the chat surface and can't be compared to
  // `claims.origin` (the merchant origin the token was minted for). The real
  // origin binding that matters — "this token was issued to a request from an
  // allowed tenant origin" — is enforced at session-mint time
  // (`matchAllowedOrigin` in session.ts), and the token is KMS-signed,
  // exp-capped (≤60m), and tenant/session-scoped. Here we require the request
  // to at least come from a browser on our own chat surface (rejects a
  // no-Origin server-side replay), without the (impossible) merchant-origin
  // equality that broke every real request.
  const chatOrigin = normalizeOrigin(`https://${process.env.CHAT_ORIGIN ?? ""}`);
  if (!reflectOrigin || (chatOrigin && reflectOrigin !== chatOrigin)) {
    return error(401, "unauthorized", "Invalid or expired session", cors);
  }

  let rawBody: unknown;
  try {
    rawBody = JSON.parse(event.body ?? "{}");
  } catch {
    return error(400, "invalid_request", "Malformed body", cors);
  }
  const parsed = ChatMessageRequest.safeParse(rawBody);
  if (!parsed.success) {
    return error(400, "invalid_request", "Invalid request", cors);
  }

  const config = await cachedTenantConfig(claims.tenant_id);
  if (!config || config.status === "suspended" || config.killSwitch) {
    return error(503, "unavailable", "Chat is temporarily unavailable", cors);
  }

  // Monthly quota enforcement — bounds runaway model spend from a leaked/abused
  // site key. Checked BEFORE the model call so an over-quota tenant is never
  // billed for another call. A usage-read failure fails CLOSED to the friendly
  // degrade (never fail-open into unlimited spend).
  const month = new Date().toISOString().slice(0, 7);
  const limit = effectiveLimit(config.monthlyMessageLimit);
  let usage: number;
  try {
    usage = await getUsage(claims.tenant_id, month);
  } catch {
    return json(
      200,
      { reply: FRIENDLY_DEGRADE, sessionId: claims.session_id },
      cors
    );
  }
  if (usage >= limit) {
    // Hard-stop the tenant so subsequent requests short-circuit at the config
    // gate, and evict this container's cached config immediately.
    try {
      await tripKillSwitch(claims.tenant_id);
      evictTenantConfig(claims.tenant_id);
    } catch {
      // Best-effort; the over-quota reply below still protects this request.
    }
    console.warn(
      JSON.stringify({
        event: "quota_exceeded",
        tenant: claims.tenant_id,
        usage,
        limit
      })
    );
    return json(
      200,
      { reply: OVER_QUOTA_REPLY, sessionId: claims.session_id },
      cors
    );
  }

  const now = Date.now();
  const pk = tenantPk(claims.tenant_id);
  // Fail OPEN on a rate-limiter infra error: the limiter is an abuse dampener,
  // not a spend boundary (quota above fails closed), so a DDB blip must not deny
  // service.
  const [sessionOk, tenantOk] = await Promise.all([
    allowFailOpen(pk, `RL#SESSION#${claims.session_id}`, SESSION_LIMIT, now),
    allowFailOpen(pk, "RL#TENANT", TENANT_LIMIT, now)
  ]);
  if (!sessionOk || !tenantOk) {
    return error(
      429,
      "rate_limited",
      "You're sending messages too quickly. Please slow down.",
      { ...cors, "retry-after": "10" }
    );
  }

  const [history, kb] = await Promise.all([
    queryHistory(claims.tenant_id, claims.session_id),
    listKb(claims.tenant_id)
  ]);

  const { prompt: systemPrompt } = assembleSystemPrompt(config.systemPrompt, {
    businessProfile: config.businessProfile,
    entries: kb
  });

  let result;
  try {
    const adapter = new AnthropicAdapter({
      apiKey: await modelApiKey(),
      model: config.model,
      systemPrompt,
      // Set when using a workspace-scoped Anthropic key; unset for org keys.
      workspaceId: process.env.ANTHROPIC_WORKSPACE_ID
    });
    result = await runChat({
      tenantId: claims.tenant_id,
      adapter,
      history,
      userMessage: parsed.data.message
    });
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "chat_degraded",
        tenant: claims.tenant_id,
        session: claims.session_id,
        error: e instanceof Error ? e.message : "unknown"
      })
    );
    return json(
      200,
      { reply: FRIENDLY_DEGRADE, sessionId: claims.session_id },
      cors
    );
  }

  // Persistence and usage accounting must NOT fail a successful, already-paid-for
  // model reply. Log and continue on error (usage under-count is acceptable; the
  // reply is the user-visible product).
  try {
    await persistMessages({
      tenantId: claims.tenant_id,
      sessionId: claims.session_id,
      messages: result.newMessages
    });
    await incrementUsage({
      tenantId: claims.tenant_id,
      month,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut
    });
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "chat_persist_failed",
        tenant: claims.tenant_id,
        session: claims.session_id,
        error: e instanceof Error ? e.message : "unknown"
      })
    );
  }

  console.log(
    JSON.stringify({
      event: "chat_message",
      tenant: claims.tenant_id,
      session: claims.session_id,
      model: config.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      latencyMs: Date.now() - now
    })
  );

  const body: ChatMessageResponse = {
    reply: result.reply,
    sessionId: claims.session_id
  };
  return json(200, ChatMessageResponse.parse(body), cors);
};
