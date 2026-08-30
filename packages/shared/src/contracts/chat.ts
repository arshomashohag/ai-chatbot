import { z } from "zod";

// Snapshot of the page the widget is embedded on, captured by the loader on the
// FIRST message of a session only. All fields optional + length-capped so older
// widgets (which send none) and the safeParse gate keep working, and a hostile
// page can't blow up the model input.
export const PageContext = z.object({
  url: z.string().max(2048).optional(),
  title: z.string().max(300).optional(),
  description: z.string().max(1000).optional(),
  text: z.string().max(12000).optional()
});
export type PageContext = z.infer<typeof PageContext>;

export const ChatMessageRequest = z.object({
  message: z.string().min(1).max(4000),
  pageContext: PageContext.optional()
});
export type ChatMessageRequest = z.infer<typeof ChatMessageRequest>;

export const ChatMessageResponse = z.object({
  reply: z.string(),
  sessionId: z.string()
});
export type ChatMessageResponse = z.infer<typeof ChatMessageResponse>;

export const ChatRole = z.enum(["user", "assistant", "tool", "system"]);
export type ChatRole = z.infer<typeof ChatRole>;

export const ToolCall = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.unknown())
});
export type ToolCall = z.infer<typeof ToolCall>;

export const StoredMessage = z.object({
  role: ChatRole,
  content: z.string(),
  toolCalls: z.array(ToolCall).optional(),
  toolCallId: z.string().optional(),
  tokensIn: z.number().optional(),
  tokensOut: z.number().optional(),
  latencyMs: z.number().optional()
});
export type StoredMessage = z.infer<typeof StoredMessage>;
