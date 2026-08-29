import { z } from "zod";

export const Appearance = z.object({
  displayName: z.string().min(1).max(60),
  greeting: z.string().min(1).max(200),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  tone: z.enum(["friendly", "professional", "playful"])
});
export type Appearance = z.infer<typeof Appearance>;

export const BusinessBasics = z.object({
  name: z.string().min(1).max(120),
  websiteUrl: z.string().url(),
  allowedDomains: z.array(z.string().url()).min(1).max(20)
});
export type BusinessBasics = z.infer<typeof BusinessBasics>;

export const KB_MAX_ENTRIES = 50;
export const KB_MAX_BYTES = 2048;

const withinByteCap = (s: string): boolean =>
  new TextEncoder().encode(s).length <= KB_MAX_BYTES;

export const KbEntry = z.object({
  id: z.string(),
  type: z.enum(["context", "faq"]),
  title: z.string().min(1).max(200),
  body: z
    .string()
    .min(1)
    .refine(withinByteCap, `body exceeds ${KB_MAX_BYTES} bytes`),
  enabled: z.boolean()
});
export type KbEntry = z.infer<typeof KbEntry>;

export const KbEntryInput = KbEntry.omit({ id: true });
export type KbEntryInput = z.infer<typeof KbEntryInput>;

export const AdminConfig = z.object({
  businessProfile: z.string().max(4000).optional(),
  appearance: Appearance.optional(),
  basics: BusinessBasics.optional(),
  setupComplete: z.boolean(),
  hasKey: z.boolean()
});
export type AdminConfig = z.infer<typeof AdminConfig>;

// Input schema for the business-profile write. Zod-bounded (max 4000) so the
// handler no longer relies on an ad-hoc typeof check + .slice (finding 3.12).
export const ProfileInput = z.object({
  businessProfile: z.string().max(4000)
});
export type ProfileInput = z.infer<typeof ProfileInput>;

export const IssueKeyResponse = z.object({
  siteKey: z.string(),
  snippet: z.string()
});
export type IssueKeyResponse = z.infer<typeof IssueKeyResponse>;

export const SessionSummary = z.object({
  sessionId: z.string(),
  origin: z.string(),
  createdAt: z.number(),
  messageCount: z.number()
});
export type SessionSummary = z.infer<typeof SessionSummary>;
