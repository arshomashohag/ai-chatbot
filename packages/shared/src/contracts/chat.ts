import { z } from "zod";

export const ChatMessageRequest = z.object({
  message: z.string().min(1).max(4000)
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
