import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand
} from "@aws-sdk/lib-dynamodb";
import { ensureUserTenant } from "./admin-ddb.js";

const ddb = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddb.reset();
  process.env.TABLE_NAME = "platform-test";
});

describe("ensureUserTenant idempotency (0.4)", () => {
  it("creates profile + config for a brand-new user", async () => {
    ddb.on(GetCommand).resolves({ Item: undefined });
    ddb.on(PutCommand).resolves({});
    const tenantId = await ensureUserTenant("sub1", "a@b.com");
    const puts = ddb.commandCalls(PutCommand).map((c) => c.args[0].input);
    const profilePut = puts.find((p) => (p.Item!.SK as string) === "PROFILE");
    const configPut = puts.find((p) => (p.Item!.SK as string) === "CONFIG");
    expect(profilePut).toBeTruthy();
    expect(configPut).toBeTruthy();
    expect(configPut!.Item!.tenantId).toBe(tenantId);
    // Seeded default color must be the brand color, not the old #4f46e5.
    expect((configPut!.Item!.branding as { color: string }).color).toBe(
      "#6d5ae6"
    );
  });

  it("recreates a MISSING config when the profile already exists (partial-failure retry)", async () => {
    // Simulate: previous invocation wrote the profile but died before config.
    ddb.on(GetCommand).resolves({
      Item: { PK: "USER#sub1", SK: "PROFILE", tenantId: "t_existing" }
    });
    ddb.on(PutCommand).resolves({});
    const tenantId = await ensureUserTenant("sub1", "a@b.com");
    expect(tenantId).toBe("t_existing");
    const puts = ddb.commandCalls(PutCommand).map((c) => c.args[0].input);
    // Must NOT re-write the profile, but MUST ensure the config exists.
    expect(puts.some((p) => (p.Item!.SK as string) === "PROFILE")).toBe(false);
    const configPut = puts.find((p) => (p.Item!.SK as string) === "CONFIG");
    expect(configPut).toBeTruthy();
    expect(configPut!.Item!.tenantId).toBe("t_existing");
  });

  it("is a no-op-safe when both profile and config already exist", async () => {
    ddb.on(GetCommand).resolves({
      Item: { PK: "USER#sub1", SK: "PROFILE", tenantId: "t_existing" }
    });
    // Config put fails the conditional (already exists) — must be swallowed.
    ddb.on(PutCommand).rejects({ name: "ConditionalCheckFailedException" });
    await expect(ensureUserTenant("sub1", "a@b.com")).resolves.toBe(
      "t_existing"
    );
  });

  it("resolves to the winning tenant when a concurrent profile write races", async () => {
    let getCall = 0;
    ddb.on(GetCommand).callsFake(() => {
      getCall++;
      // First check: no profile yet -> we try to create one.
      if (getCall === 1) return { Item: undefined };
      // After our profile put loses the race, re-read returns the winner.
      return { Item: { tenantId: "t_winner" } };
    });
    ddb.on(PutCommand).callsFake((input) => {
      if ((input.Item.SK as string) === "PROFILE") {
        throw { name: "ConditionalCheckFailedException" };
      }
      return {};
    });
    const tenantId = await ensureUserTenant("sub1", "a@b.com");
    expect(tenantId).toBe("t_winner");
    const configPut = ddb
      .commandCalls(PutCommand)
      .map((c) => c.args[0].input)
      .find((p) => (p.Item!.SK as string) === "CONFIG");
    expect(configPut!.Item!.tenantId).toBe("t_winner");
  });
});
