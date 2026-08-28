import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { allow, SESSION_LIMIT } from "./rate-limit.js";

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
});
