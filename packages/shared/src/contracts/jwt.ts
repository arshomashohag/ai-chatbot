import { z } from "zod";

export const WidgetClaims = z.object({
  tenant_id: z.string(),
  session_id: z.string(),
  origin: z.string(),
  iat: z.number(),
  exp: z.number()
});
export type WidgetClaims = z.infer<typeof WidgetClaims>;

export const JWT_ALG = "ES256" as const;
export const MAX_SESSION_TTL_SECONDS = 60 * 60;
