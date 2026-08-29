import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import {
  ChatMessageRequest,
  ChatMessageResponse
} from "@platform/shared";
import { json, error } from "../lib/http.js";
import { verifyWidgetJwt, JwtError } from "../lib/jwt-verify.js";
import { cachedTenantConfig } from "../lib/config-cache.js";
import { queryHistory, persistMessages, incrementUsage } from "../lib/ddb.js";
import { AnthropicAdapter } from "../lib/adapter/anthropic.js";
import { modelApiKey } from "../lib/secrets.js";
import { runChat } from "../lib/chat-engine.js";
import {
  allow,
  SESSION_LIMIT,
  TENANT_LIMIT
} from "../lib/rate-limit.js";
import { listKb } from "../lib/admin-ddb.js";
import { assembleSystemPrompt } from "../lib/prompt-assembly.js";
import { tenantPk } from "@platform/shared";

const FRIENDLY_DEGRADE =
  "Sorry, I'm having trouble right now. Please try again in a moment.";

function bearer(event: { headers?: Record<string, string | undefined> }) {
  const raw =
    event.headers?.authorization ?? event.headers?.Authorization ?? "";
  return raw.startsWith("Bearer ") ? raw.slice(7) : "";
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const keyId = process.env.JWT_KMS_KEY_ID;
  if (!keyId) throw new Error("JWT_KMS_KEY_ID is required");

  const token = bearer(event);
  let claims;
  try {
    claims = await verifyWidgetJwt(token, keyId);
  } catch (e) {
    if (e instanceof JwtError) {
      return error(401, "unauthorized", "Invalid or expired session");
    }
    throw e;
  }

  const parsed = ChatMessageRequest.safeParse(
    JSON.parse(event.body ?? "{}")
  );
  if (!parsed.success) {
    return error(400, "invalid_request", "Invalid request");
  }

  const config = await cachedTenantConfig(claims.tenant_id);
  if (!config || config.status === "suspended" || config.killSwitch) {
    return error(503, "unavailable", "Chat is temporarily unavailable");
  }

  const now = Date.now();
  const pk = tenantPk(claims.tenant_id);
  const [sessionOk, tenantOk] = await Promise.all([
    allow(pk, `RL#SESSION#${claims.session_id}`, SESSION_LIMIT, now),
    allow(pk, "RL#TENANT", TENANT_LIMIT, now)
  ]);
  if (!sessionOk || !tenantOk) {
    return error(
      429,
      "rate_limited",
      "You're sending messages too quickly. Please slow down.",
      { "retry-after": "10" }
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
      systemPrompt
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
    return json(200, {
      reply: FRIENDLY_DEGRADE,
      sessionId: claims.session_id
    });
  }

  const month = new Date().toISOString().slice(0, 7);
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
  return json(200, ChatMessageResponse.parse(body));
};
