import Anthropic from "@anthropic-ai/sdk";
import { ulid } from "../ulid.js";
import type { ToolDefinition, ToolCall } from "@platform/shared";
import type { AdapterMessage, CompletionResult, ModelAdapter } from "./types.js";

interface AnthropicAdapterOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  maxTokens?: number;
  // Required when the API key is identity-linked (workspace-scoped): Anthropic
  // rejects the request with "anthropic-workspace-id is required ..." unless the
  // workspace id is sent as a header. Optional for standard (org-level) keys.
  workspaceId?: string;
}

function toAnthropicMessages(
  messages: AdapterMessage[]
): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.toolCallId ?? "",
            content: m.content
          }
        ]
      });
      continue;
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: m.toolCalls.map((tc) => ({
          type: "tool_use" as const,
          id: tc.id,
          name: tc.name,
          input: tc.arguments
        }))
      });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool.InputSchema
  }));
}

export class AnthropicAdapter implements ModelAdapter {
  private client: Anthropic;
  private model: string;
  private systemPrompt: string;
  private maxTokens: number;

  constructor(opts: AnthropicAdapterOptions) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.workspaceId
        ? { defaultHeaders: { "anthropic-workspace-id": opts.workspaceId } }
        : {})
    });
    this.model = opts.model;
    this.systemPrompt = opts.systemPrompt;
    this.maxTokens = opts.maxTokens ?? 1024;
  }

  async complete(
    messages: AdapterMessage[],
    tools: ToolDefinition[]
  ): Promise<CompletionResult> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: this.systemPrompt,
      messages: toAnthropicMessages(messages),
      tools: toAnthropicTools(tools)
    });

    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const block of res.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id ?? ulid(),
          name: block.name,
          arguments: (block.input as Record<string, unknown>) ?? {}
        });
      }
    }

    return {
      text,
      toolCalls,
      tokensIn: res.usage.input_tokens,
      tokensOut: res.usage.output_tokens
    };
  }
}
