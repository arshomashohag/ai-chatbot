import { describe, it, expect, beforeEach } from "vitest";
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
