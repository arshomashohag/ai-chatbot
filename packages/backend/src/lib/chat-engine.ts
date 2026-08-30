import {
  TOOL_DEFINITIONS,
  MAX_TOOL_ITERATIONS,
  type StoredMessage,
  type PageContext
} from "@platform/shared";
import type { AdapterMessage, ModelAdapter } from "./adapter/types.js";
import { executeTool } from "./tools-exec.js";

// How the page snapshot is framed into the model's user turn. `changed` flags a
// page whose content differs from what the model was last shown, so it can note
// the shift rather than treating stale context as current.
export function framePageContext(
  userMessage: string,
  page: PageContext,
  changed: boolean
): string {
  const lines: string[] = [];
  lines.push(
    changed
      ? "The content of the page the visitor is viewing has changed since it was last seen. Here is the current page:"
      : "The visitor is viewing this page:"
  );
  if (page.url) lines.push(`URL: ${page.url}`);
  if (page.title) lines.push(`Title: ${page.title}`);
  if (page.description) lines.push(`Description: ${page.description}`);
  if (page.text) lines.push(`\nPage content:\n${page.text}`);
  lines.push(
    `\nThe visitor asked: "${userMessage}"\n` +
      "Answer using the page content, the knowledge base, and your general " +
      "knowledge. If the page doesn't help, answer normally."
  );
  return lines.join("\n");
}

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
  // Optional page snapshot to ground this turn. When present, the model sees the
  // framed message (page + question); history still stores the clean message so
  // the portal transcript shows the real question, not a page dump. `pageChanged`
  // tells the framing to say the page changed vs. is being shown for the first
  // time.
  pageContext?: PageContext;
  pageChanged?: boolean;
}): Promise<ChatResult> {
  const { tenantId, adapter, history, userMessage, pageContext } = params;

  const modelMessage = pageContext
    ? framePageContext(userMessage, pageContext, Boolean(params.pageChanged))
    : userMessage;

  // Persist the CLEAN message; send the FRAMED message to the model.
  const userMsg: StoredMessage = { role: "user", content: userMessage };
  const newMessages: StoredMessage[] = [userMsg];
  const working: AdapterMessage[] = [
    ...toAdapterMessages(history),
    { role: "user", content: modelMessage }
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
