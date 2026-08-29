import { z } from "zod";

export const SessionRequest = z.object({
  siteKey: z.string().min(8)
});
export type SessionRequest = z.infer<typeof SessionRequest>;

export const Branding = z.object({
  displayName: z.string(),
  greeting: z.string(),
  color: z.string(),
  // Optional tenant-specific starter prompts (e.g. from KB titles). When absent
  // the widget shows no suggestions rather than generic hardcoded ones.
  suggestedPrompts: z.array(z.string()).max(3).optional()
});
export type Branding = z.infer<typeof Branding>;

export const SessionResponse = z.object({
  token: z.string(),
  sessionId: z.string(),
  expiresAt: z.number(),
  branding: Branding
});
export type SessionResponse = z.infer<typeof SessionResponse>;

export const ErrorResponse = z.object({
  error: z.object({ code: z.string(), message: z.string() })
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const WIDGET_ERROR_CODES = {
  BAD_SITE_KEY: "bad_site_key",
  ORIGIN_NOT_ALLOWED: "origin_not_allowed",
  TENANT_SUSPENDED: "tenant_suspended",
  INVALID_REQUEST: "invalid_request"
} as const;
