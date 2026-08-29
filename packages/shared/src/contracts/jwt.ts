import { z } from "zod";

export const WidgetClaims = z.object({
  tenant_id: z.string(),
  session_id: z.string(),
  origin: z.string(),
  iss: z.string(),
  aud: z.string(),
  iat: z.number(),
  exp: z.number()
});
export type WidgetClaims = z.infer<typeof WidgetClaims>;

export const JWT_ALG = "ES256" as const;
export const MAX_SESSION_TTL_SECONDS = 60 * 60;

// Issuer and audience the widget JWT is bound to. Enforced on verify so a token
// minted for a different purpose (a future service sharing the KMS verify key)
// cannot be replayed against the chat API.
export const JWT_ISS = "chatbot-widget" as const;
export const JWT_AUD = "chatbot-chat-api" as const;
