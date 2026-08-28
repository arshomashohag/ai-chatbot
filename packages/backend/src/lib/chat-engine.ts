import {
  TOOL_DEFINITIONS,
  MAX_TOOL_ITERATIONS,
  type StoredMessage
} from "@platform/shared";
import type { AdapterMessage, ModelAdapter } from "./adapter/types.js";
import { executeTool } from "./tools-exec.js";

export interface ChatResult {
  reply: string;
  newMessages: StoredMessage[];
  tokensIn: number;
  tokensOut: number;
}

function toAdapterMessages(history: StoredMessage[]): AdapterMessage[] {
  return history.map((m) => ({
    role: m.role === "tool" ? "tool" : (m.role as AdapterMessage["role"]),
    content: m.content,
    toolCalls: m.toolCalls,
    toolCallId: m.toolCallId
  }));
}

export async function runChat(params: {
  tenantId: string;
  adapter: ModelAdapter;
  history: StoredMessage[];
  userMessage: string;
}): Promise<ChatResult> {
  const { tenantId, adapter, history, userMessage } = params;

  const userMsg: StoredMessage = { role: "user", content: userMessage };
  const newMessages: StoredMessage[] = [userMsg];
  const working: AdapterMessage[] = [
    ...toAdapterMessages(history),
    { role: "user", content: userMessage }
  ];

  let tokensIn = 0;
  let tokensOut = 0;
  let reply = "";

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const res = await adapter.complete(working, TOOL_DEFINITIONS);
    tokensIn += res.tokensIn;
    tokensOut += res.tokensOut;

    if (res.toolCalls.length === 0) {
      reply = res.text;
      newMessages.push({
        role: "assistant",
        content: res.text,
        tokensIn: res.tokensIn,
        tokensOut: res.tokensOut
      });
      working.push({ role: "assistant", content: res.text });
      return { reply, newMessages, tokensIn, tokensOut };
    }

    newMessages.push({
      role: "assistant",
      content: res.text,
      toolCalls: res.toolCalls,
      tokensIn: res.tokensIn,
      tokensOut: res.tokensOut
    });
    working.push({
      role: "assistant",
      content: res.text,
      toolCalls: res.toolCalls
    });

    for (const call of res.toolCalls) {
      const result = await executeTool(tenantId, call);
      newMessages.push({
        role: "tool",
        content: result,
        toolCallId: call.id
      });
      working.push({ role: "tool", content: result, toolCallId: call.id });
    }
  }

  reply =
    "I'm having trouble completing that request. Please try rephrasing.";
  newMessages.push({ role: "assistant", content: reply });
  return { reply, newMessages, tokensIn, tokensOut };
}
