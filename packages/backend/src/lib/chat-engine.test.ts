import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { runChat } from "./chat-engine.js";
import { MockAdapter } from "./adapter/mock.js";

const ddb = mockClient(DynamoDBDocumentClient);

describe("runChat", () => {
  beforeEach(() => {
    ddb.reset();
    process.env.TABLE_NAME = "platform-test";
    ddb.on(QueryCommand).resolves({
      Items: [
        { productId: "p1", name: "Blue T-Shirt", price: 19, available: true },
        { productId: "p2", name: "Red Hat", price: 12, available: true }
      ]
    });
  });

  it("runs a scripted conversation that calls search_products then answers", async () => {
    const adapter = new MockAdapter([
      {
        toolCalls: [
          {
            id: "tc1",
            name: "search_products",
            arguments: { query: "blue" }
          }
        ]
      },
      { text: "Yes! We have a Blue T-Shirt for $19." }
    ]);

    const result = await runChat({
      tenantId: "t_dev",
      adapter,
      history: [],
      userMessage: "do you have blue t-shirts?"
    });

    expect(result.reply).toContain("Blue T-Shirt");
    const roles = result.newMessages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool", "assistant"]);
    const toolMsg = result.newMessages.find((m) => m.role === "tool");
    expect(toolMsg!.content).toContain("Blue T-Shirt");
    expect(result.tokensIn).toBeGreaterThan(0);
    expect(adapter.calls.length).toBe(2);
  });

  it("caps the tool loop at MAX_TOOL_ITERATIONS", async () => {
    const looping = Array.from({ length: 10 }, () => ({
      toolCalls: [
        { id: "x", name: "search_products", arguments: { query: "a" } }
      ]
    }));
    const adapter = new MockAdapter(looping);
    const result = await runChat({
      tenantId: "t_dev",
      adapter,
      history: [],
      userMessage: "loop"
    });
    expect(adapter.calls.length).toBe(5);
    expect(result.reply).toContain("trouble");
  });

  it("degrades gracefully when the adapter throws", async () => {
    const adapter = new MockAdapter([{ throws: "provider down" }]);
    await expect(
      runChat({
        tenantId: "t_dev",
        adapter,
        history: [],
        userMessage: "hi"
      })
    ).rejects.toThrow("provider down");
  });

  it("tool executor degrades to a friendly message on unknown tool", async () => {
    const adapter = new MockAdapter([
      { toolCalls: [{ id: "u", name: "unknown_tool", arguments: {} }] },
      { text: "ok" }
    ]);
    const result = await runChat({
      tenantId: "t_dev",
      adapter,
      history: [],
      userMessage: "x"
    });
    const toolMsg = result.newMessages.find((m) => m.role === "tool");
    expect(toolMsg!.content).toContain("unknown tool");
  });
});
