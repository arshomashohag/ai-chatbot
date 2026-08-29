import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  BatchWriteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import type { StoredMessage } from "@platform/shared";
import { messageSk } from "@platform/shared";
import { chunk, queryHistory, persistMessages } from "./ddb.js";

const ddb = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddb.reset();
  process.env.TABLE_NAME = "platform-test";
});

describe("chunk (pure)", () => {
  it("splits into groups of at most `size`", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("throws on size < 1", () => {
    expect(() => chunk([1], 0)).toThrow();
  });

  // PBT-03 (invariant), PBT-07 (generators), PBT-08 (shrinking/seed via fast-check)
  it("property: concatenation of chunks equals the input; every chunk <= size", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer()),
        fc.integer({ min: 1, max: 50 }),
        (arr, size) => {
          const chunks = chunk(arr, size);
          expect(chunks.flat()).toEqual(arr);
          expect(chunks.every((c) => c.length <= size)).toBe(true);
          if (arr.length > 0) {
            expect(chunks.length).toBe(Math.ceil(arr.length / size));
          }
        }
      )
    );
  });
});

describe("messageSk ordering (invariant)", () => {
  // ULIDs are the caller's monotonic ids; assert the key format preserves the
  // ordering of already-sorted ids (PBT-03 invariant on a pure function).
  it("property: sorted ids produce sorted MSG# keys", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 1 }),
        (ids) => {
          const sorted = [...ids].sort();
          const keys = sorted.map(messageSk);
          expect([...keys].sort()).toEqual(keys);
        }
      )
    );
  });
});

describe("queryHistory (0.1 — most-recent, chronological)", () => {
  it("requests newest-first (ScanIndexForward:false) and returns chronological", async () => {
    // DDB returns newest-first; queryHistory must reverse to oldest->newest.
    ddb.on(QueryCommand).resolves({
      Items: [
        { role: "assistant", content: "c3" },
        { role: "user", content: "c2" },
        { role: "assistant", content: "c1" }
      ]
    });
    const out = await queryHistory("t", "s", 3);
    const input = ddb.commandCalls(QueryCommand)[0]!.args[0].input;
    expect(input.ScanIndexForward).toBe(false);
    expect(input.Limit).toBe(3);
    expect(out.map((m) => m.content)).toEqual(["c1", "c2", "c3"]);
  });
});

describe("persistMessages (0.2 — collision-free, chunked, counted)", () => {
  it("writes MSG#<ulid> keys with no #0000 collision across calls", async () => {
    ddb.on(BatchWriteCommand).resolves({});
    ddb.on(UpdateCommand).resolves({});
    const msg: StoredMessage[] = [{ role: "user", content: "hi" }];
    await persistMessages({ tenantId: "t", sessionId: "s", messages: msg });
    await persistMessages({ tenantId: "t", sessionId: "s", messages: msg });
    const calls = ddb.commandCalls(BatchWriteCommand);
    const sk1 = calls[0]!.args[0].input.RequestItems!["platform-test"]![0]!
      .PutRequest!.Item!.SK as string;
    const sk2 = calls[1]!.args[0].input.RequestItems!["platform-test"]![0]!
      .PutRequest!.Item!.SK as string;
    expect(sk1.startsWith("MSG#")).toBe(true);
    expect(sk1).not.toBe(sk2); // no same-ms overwrite
  });

  it("splits >25 messages into multiple BatchWrite calls of <=25", async () => {
    ddb.on(BatchWriteCommand).resolves({});
    ddb.on(UpdateCommand).resolves({});
    const many: StoredMessage[] = Array.from({ length: 60 }, (_, i) => ({
      role: "assistant" as const,
      content: `m${i}`
    }));
    await persistMessages({ tenantId: "t", sessionId: "s", messages: many });
    const calls = ddb.commandCalls(BatchWriteCommand);
    expect(calls.length).toBe(3); // 25 + 25 + 10
    for (const c of calls) {
      expect(c.args[0].input.RequestItems!["platform-test"]!.length).toBeLessThanOrEqual(25);
    }
  });

  it("retries UnprocessedItems until drained", async () => {
    const table = "platform-test";
    let call = 0;
    ddb.on(BatchWriteCommand).callsFake((input) => {
      call++;
      const items = input.RequestItems[table];
      // First response leaves one item unprocessed; second drains it.
      if (call === 1) return { UnprocessedItems: { [table]: [items[0]] } };
      return { UnprocessedItems: {} };
    });
    ddb.on(UpdateCommand).resolves({});
    await persistMessages({
      tenantId: "t",
      sessionId: "s",
      messages: [{ role: "user", content: "hi" }]
    });
    expect(ddb.commandCalls(BatchWriteCommand).length).toBe(2);
  });

  it("throws if items remain unprocessed after retries", async () => {
    const table = "platform-test";
    ddb.on(BatchWriteCommand).callsFake((input) => ({
      UnprocessedItems: { [table]: input.RequestItems[table] }
    }));
    await expect(
      persistMessages({
        tenantId: "t",
        sessionId: "s",
        messages: [{ role: "user", content: "hi" }]
      })
    ).rejects.toThrow(/unprocessed/);
  });

  it("increments messageCount only for user/assistant messages", async () => {
    ddb.on(BatchWriteCommand).resolves({});
    ddb.on(UpdateCommand).resolves({});
    await persistMessages({
      tenantId: "t",
      sessionId: "s",
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", content: "a" },
        { role: "tool", content: "{}", toolCallId: "x" }
      ]
    });
    const upd = ddb
      .commandCalls(UpdateCommand)
      .map((c) => c.args[0].input)
      .find((i) => i.UpdateExpression?.includes("messageCount"))!;
    expect(upd.ExpressionAttributeValues![":n"]).toBe(2);
    expect(upd.Key!.SK).toBe("SESSION#s");
  });
});
