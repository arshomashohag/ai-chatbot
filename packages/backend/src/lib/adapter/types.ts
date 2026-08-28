import type { ToolDefinition, ToolCall } from "@platform/shared";

export interface AdapterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface CompletionResult {
  text: string;
  toolCalls: ToolCall[];
  tokensIn: number;
  tokensOut: number;
}

export interface ModelAdapter {
  complete(
    messages: AdapterMessage[],
    tools: ToolDefinition[]
  ): Promise<CompletionResult>;
}
