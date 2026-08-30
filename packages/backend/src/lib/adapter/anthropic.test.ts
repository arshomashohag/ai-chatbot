import { describe, it, expect } from "vitest";
import { AnthropicAdapter } from "./anthropic.js";

// Verifies the workspace-id header wiring — the fix for identity-linked
// (workspace-scoped) Anthropic keys, which are rejected with
// "anthropic-workspace-id is required ..." unless the header is sent.

function headersOf(adapter: AnthropicAdapter): Record<string, string> {
  // The SDK stores constructor defaultHeaders on the client instance.
  const client = (adapter as unknown as { client: { _options?: { defaultHeaders?: Record<string, string> } } }).client;
  return client._options?.defaultHeaders ?? {};
}

describe("AnthropicAdapter workspace-id header", () => {
  it("sends anthropic-workspace-id when a workspaceId is provided", () => {
    const adapter = new AnthropicAdapter({
      apiKey: "sk-test",
      model: "claude-haiku-4-5",
      systemPrompt: "sp",
      workspaceId: "ws_123"
    });
    expect(headersOf(adapter)["anthropic-workspace-id"]).toBe("ws_123");
  });

  it("omits the header when no workspaceId is set (standard org key)", () => {
    const adapter = new AnthropicAdapter({
      apiKey: "sk-test",
      model: "claude-haiku-4-5",
      systemPrompt: "sp"
    });
    expect(headersOf(adapter)["anthropic-workspace-id"]).toBeUndefined();
  });

  it("treats an empty-string workspaceId as unset (no header)", () => {
    const adapter = new AnthropicAdapter({
      apiKey: "sk-test",
      model: "claude-haiku-4-5",
      systemPrompt: "sp",
      workspaceId: ""
    });
    expect(headersOf(adapter)["anthropic-workspace-id"]).toBeUndefined();
  });
});
