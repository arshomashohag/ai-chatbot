import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { allow, allowFailOpen, SESSION_LIMIT } from "./rate-limit.js";

const ddb = mockClient(DynamoDBDocumentClient);

describe("fixed-window rate limiter", () => {
  beforeEach(() => {
    ddb.reset();
    process.env.TABLE_NAME = "platform-test";
  });

  it("allows when the conditional update succeeds", async () => {
    ddb.on(UpdateCommand).resolves({});
    const ok = await allow("TENANT#t", "RL#TENANT", SESSION_LIMIT, 0);
    expect(ok).toBe(true);
  });

  it("throttles (returns false) on ConditionalCheckFailedException", async () => {
    ddb.on(UpdateCommand).rejects({ name: "ConditionalCheckFailedException" });
    const ok = await allow("TENANT#t", "RL#TENANT", SESSION_LIMIT, 0);
    expect(ok).toBe(false);
  });

  it("keys the counter by fixed window so windows are isolated", async () => {
    ddb.on(UpdateCommand).resolves({});
    await allow("TENANT#t", "RL#S", SESSION_LIMIT, 0);
    await allow("TENANT#t", "RL#S", SESSION_LIMIT, 60_000);
    const calls = ddb.commandCalls(UpdateCommand);
    const sk0 = calls[0]!.args[0].input.Key!.SK;
    const sk1 = calls[1]!.args[0].input.Key!.SK;
    expect(sk0).not.toBe(sk1);
    expect(sk0).toBe("RL#S#0");
    expect(sk1).toBe("RL#S#1");
  });

  it("rethrows non-conditional errors", async () => {
    ddb.on(UpdateCommand).rejects({ name: "ProvisionedThroughputExceeded" });
    await expect(
      allow("TENANT#t", "RL#T", SESSION_LIMIT, 0)
    ).rejects.toBeTruthy();
  });

  it("sets a TTL that is epoch-seconds ~2 windows in the future (3.13)", async () => {
    ddb.on(UpdateCommand).resolves({});
    const nowMs = 1_800_000_000_000; // fixed epoch ms
    await allow("TENANT#t", "RL#S", SESSION_LIMIT, nowMs);
    const input = ddb.commandCalls(UpdateCommand)[0]!.args[0].input;
    const ttl = input.ExpressionAttributeValues![":ttl"] as number;
    const nowSec = Math.floor(nowMs / 1000);
    expect(ttl).toBe(nowSec + SESSION_LIMIT.windowSec * 2);
    expect(ttl).toBeGreaterThan(nowSec);
  });
});

describe("allowFailOpen", () => {
  beforeEach(() => {
    ddb.reset();
    process.env.TABLE_NAME = "platform-test";
  });

  it("returns false (throttled) on a real cap hit", async () => {
    ddb.on(UpdateCommand).rejects({ name: "ConditionalCheckFailedException" });
    expect(await allowFailOpen("TENANT#t", "RL#S", SESSION_LIMIT, 0)).toBe(
      false
    );
  });

  it("fails OPEN (returns true) on an infrastructure error", async () => {
    ddb.on(UpdateCommand).rejects({ name: "ProvisionedThroughputExceeded" });
    expect(await allowFailOpen("TENANT#t", "RL#S", SESSION_LIMIT, 0)).toBe(
      true
    );
  });
});

describe("rate limiter invariants (3.28, PBT)", () => {
  beforeEach(() => {
    ddb.reset();
    process.env.TABLE_NAME = "platform-test";
    ddb.on(UpdateCommand).resolves({});
  });

  // Simulate the real conditional-counter semantics against a stateful mock:
  // exactly `max` calls in a window are allowed and the (max+1)th is throttled.
  // This catches a `<` → `<=` operator bug (which would allow max+1) because we
  // faithfully evaluate the same `attribute_not_exists(#c) OR #c < :max`
  // condition the code sends.
  it("property: exactly `max` calls allowed per window, (max+1)th throttled", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 20 }), async (max) => {
        ddb.reset();
        let count = 0;
        ddb.on(UpdateCommand).callsFake((input) => {
          // Evaluate the exact condition the limiter sends.
          const cond = input.ConditionExpression as string;
          const strict = cond.includes("#c < :max");
          const allowed = count === 0 || (strict ? count < max : count <= max);
          if (!allowed) throw { name: "ConditionalCheckFailedException" };
          count += 1;
          return {};
        });
        const limit = { max, windowSec: 60 };
        for (let i = 0; i < max; i++) {
          expect(await allow("TENANT#t", "RL#S", limit, 0)).toBe(true);
        }
        // The (max+1)th must be throttled.
        expect(await allow("TENANT#t", "RL#S", limit, 0)).toBe(false);
      }),
      { numRuns: 15 }
    );
  });

  // PBT-03 (invariant) + PBT-07 (generator) + PBT-08 (fast-check seed/shrink):
  // for any nowMs, the TTL is epoch-seconds strictly in the future and the
  // window index is monotonic non-decreasing in time.
  it("property: TTL > now and window is monotonic in nowMs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 4_000_000_000_000 }),
        fc.integer({ min: 0, max: 3_600_000 }),
        async (nowMs, deltaMs) => {
          ddb.reset();
          ddb.on(UpdateCommand).resolves({});
          await allow("TENANT#t", "RL#S", SESSION_LIMIT, nowMs);
          await allow("TENANT#t", "RL#S", SESSION_LIMIT, nowMs + deltaMs);
          const calls = ddb.commandCalls(UpdateCommand);
          const ttl0 = calls[0]!.args[0].input.ExpressionAttributeValues![":ttl"];
          const w0 = (calls[0]!.args[0].input.Key!.SK as string).split("#").pop()!;
          const w1 = (calls[1]!.args[0].input.Key!.SK as string).split("#").pop()!;
          expect(ttl0).toBeGreaterThan(Math.floor(nowMs / 1000));
          expect(Number(w1)).toBeGreaterThanOrEqual(Number(w0));
        }
      ),
      { numRuns: 25 }
    );
  });
});
