import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  BatchWriteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import {
  tenantPk,
  sessionPk,
  siteKeyGsi
} from "@platform/shared";
import { hashSiteKey } from "@platform/shared/node";
import {
  searchProducts,
  queryHistory,
  persistMessages,
  incrementUsage,
  getTenantConfig
} from "./lib/ddb.js";
import { allow, SESSION_LIMIT } from "./lib/rate-limit.js";

const ddb = mockClient(DynamoDBDocumentClient);
const A = "tenant_a";
const B = "tenant_b";

function pkOf(input: { Key?: Record<string, unknown>; ExpressionAttributeValues?: Record<string, unknown> }): string {
  if (input.Key?.PK) return input.Key.PK as string;
  return (input.ExpressionAttributeValues?.[":pk"] as string) ?? "";
}

describe("cross-tenant isolation: every access for tenant A stays under TENANT#tenant_a", () => {
  beforeEach(() => {
    ddb.reset();
    process.env.TABLE_NAME = "platform-test";
    ddb.on(QueryCommand).resolves({ Items: [] });
    ddb.on(GetCommand).resolves({ Item: undefined });
    ddb.on(BatchWriteCommand).resolves({});
    ddb.on(UpdateCommand).resolves({});
  });

  it("searchProducts reads only tenant A's product partition", async () => {
    await searchProducts(A, "shirt");
    const pk = pkOf(ddb.commandCalls(QueryCommand)[0]!.args[0].input);
    expect(pk).toBe(tenantPk(A));
    expect(pk).not.toContain(B);
  });

  it("queryHistory reads only tenant A's session partition", async () => {
    await queryHistory(A, "sess_x");
    const pk = pkOf(ddb.commandCalls(QueryCommand)[0]!.args[0].input);
    expect(pk).toBe(sessionPk(A, "sess_x"));
    expect(pk.startsWith(`TENANT#${A}#`)).toBe(true);
  });

  it("a tenant-A token with tenant-B's session_id cannot reach B's messages", async () => {
    await queryHistory(A, "sess_owned_by_b");
    const pk = pkOf(ddb.commandCalls(QueryCommand)[0]!.args[0].input);
    expect(pk).toBe(`TENANT#${A}#SESSION#sess_owned_by_b`);
    expect(pk).not.toBe(`TENANT#${B}#SESSION#sess_owned_by_b`);
  });

  it("persistMessages writes only under tenant A's partition", async () => {
    await persistMessages({
      tenantId: A,
      sessionId: "s1",
      messages: [{ role: "user", content: "hi" }]
    });
    const req = ddb.commandCalls(BatchWriteCommand)[0]!.args[0].input;
    const items = req.RequestItems!["platform-test"]!;
    for (const it of items) {
      const pk = it.PutRequest!.Item!.PK as string;
      expect(pk.startsWith(`TENANT#${A}#`)).toBe(true);
      expect(pk).not.toContain(B);
    }
    // The messageCount increment must also stay under tenant A's partition.
    const countUpdate = ddb
      .commandCalls(UpdateCommand)
      .map((c) => c.args[0].input)
      .find((i) => i.UpdateExpression?.includes("messageCount"));
    expect(countUpdate?.Key!.PK).toBe(tenantPk(A));
  });

  it("incrementUsage writes only under tenant A", async () => {
    await incrementUsage({ tenantId: A, month: "2026-01", tokensIn: 1, tokensOut: 1 });
    const pk = ddb.commandCalls(UpdateCommand)[0]!.args[0].input.Key!.PK;
    expect(pk).toBe(tenantPk(A));
  });

  it("rate-limit counters live under the tenant partition", async () => {
    await allow(tenantPk(A), "RL#TENANT", SESSION_LIMIT, 0);
    const pk = ddb.commandCalls(UpdateCommand)[0]!.args[0].input.Key!.PK;
    expect(pk).toBe(tenantPk(A));
  });

  it("tenant B's rate counter is a distinct item — A cannot decrement or reset B's", async () => {
    await allow(tenantPk(A), "RL#TENANT", SESSION_LIMIT, 0);
    await allow(tenantPk(B), "RL#TENANT", SESSION_LIMIT, 0);
    const calls = ddb.commandCalls(UpdateCommand);
    const keyA = calls[0]!.args[0].input.Key!;
    const keyB = calls[1]!.args[0].input.Key!;
    // Same SK (same window) but different PK → different DDB items.
    expect(keyB.PK).toBe(tenantPk(B));
    expect(keyB.PK).not.toBe(tenantPk(A));
    expect(`${keyA.PK}|${keyA.SK}`).not.toBe(`${keyB.PK}|${keyB.SK}`);
  });

  it("getTenantConfig for A never touches tenant B's config item", async () => {
    await getTenantConfig(A);
    const pk = ddb.commandCalls(GetCommand)[0]!.args[0].input.Key!.PK;
    expect(pk).toBe(tenantPk(A));
    expect(pk).not.toBe(tenantPk(B));
  });

  it("every DDB access issued for A carries a tenant-A key and never a tenant-B key", async () => {
    await getTenantConfig(A);
    await searchProducts(A, "x");
    await queryHistory(A, "s");
    await incrementUsage({ tenantId: A, month: "2026-01", tokensIn: 0, tokensOut: 0 });
    await allow(tenantPk(A), "RL#TENANT", SESSION_LIMIT, 0);

    const allKeys = [
      ...ddb.commandCalls(GetCommand).map((c) => pkOf(c.args[0].input)),
      ...ddb.commandCalls(QueryCommand).map((c) => pkOf(c.args[0].input)),
      ...ddb.commandCalls(UpdateCommand).map((c) => pkOf(c.args[0].input))
    ];
    for (const k of allKeys) {
      expect(k.startsWith(`TENANT#${A}`)).toBe(true);
      expect(k).not.toContain(B);
    }
  });

  it("site-key GSI keys are namespaced by hash, not tenant-guessable", () => {
    const a = siteKeyGsi(hashSiteKey("pk_a"));
    const b = siteKeyGsi(hashSiteKey("pk_b"));
    expect(a.GSI1PK).not.toBe(b.GSI1PK);
  });
});

describe("admin-route isolation: tenant derived from Cognito sub, KB/sessions tenant-scoped", () => {
  beforeEach(() => {
    ddb.reset();
    process.env.TABLE_NAME = "platform-test";
    ddb.on(QueryCommand).resolves({ Items: [] });
    ddb.on(GetCommand).resolves({ Item: undefined });
    ddb.on(UpdateCommand).resolves({});
  });

  it("listKb reads only tenant A's KB partition", async () => {
    const { listKb } = await import("./lib/admin-ddb.js");
    await listKb(A);
    const pk = pkOf(ddb.commandCalls(QueryCommand)[0]!.args[0].input);
    expect(pk).toBe(tenantPk(A));
    expect(pk).not.toContain(B);
  });

  it("listSessions and getTranscript stay under tenant A", async () => {
    const { listSessions, getTranscript } = await import("./lib/admin-ddb.js");
    await listSessions(A);
    await getTranscript(A, "sess_owned_by_b");
    const pks = ddb
      .commandCalls(QueryCommand)
      .map((c) => pkOf(c.args[0].input));
    expect(pks[0]).toBe(tenantPk(A));
    expect(pks[1]).toBe(`TENANT#${A}#SESSION#sess_owned_by_b`);
    for (const pk of pks) expect(pk).not.toContain(B);
  });

  it("getUserTenantId reads the caller's own USER# record only", async () => {
    const { getUserTenantId } = await import("./lib/admin-ddb.js");
    await getUserTenantId("sub_a");
    const pk = ddb.commandCalls(GetCommand)[0]!.args[0].input.Key!.PK;
    expect(pk).toBe("USER#sub_a");
  });
});

describe("tenant-access guard: malformed tenant ids never reach DynamoDB (2.1)", () => {
  beforeEach(() => {
    ddb.reset();
    process.env.TABLE_NAME = "platform-test";
    ddb.on(QueryCommand).resolves({ Items: [] });
    ddb.on(GetCommand).resolves({ Item: undefined });
    ddb.on(BatchWriteCommand).resolves({});
    ddb.on(UpdateCommand).resolves({});
  });

  // A bug (or attacker-influenced input) that let a wildcard/partition-escape
  // tenant id through would broaden the query past a single tenant. The guard
  // throws BEFORE any DDB call, so no such key is ever issued.
  const bad = ["*", "TENANT#other", "a#b", "", "  ", "a/b"];

  it("queryHistory rejects wildcard/injection ids before any DDB call", async () => {
    const { queryHistory } = await import("./lib/ddb.js");
    for (const t of bad) {
      await expect(queryHistory(t, "s1")).rejects.toThrow(/invalid tenant id/);
    }
    expect(ddb.commandCalls(QueryCommand).length).toBe(0);
  });

  it("getTenantConfig rejects malformed ids before any DDB call", async () => {
    const { getTenantConfig } = await import("./lib/ddb.js");
    for (const t of bad) {
      await expect(getTenantConfig(t)).rejects.toThrow(/invalid tenant id/);
    }
    expect(ddb.commandCalls(GetCommand).length).toBe(0);
  });

  it("listKb (admin path) rejects malformed ids before any DDB call", async () => {
    const { listKb } = await import("./lib/admin-ddb.js");
    for (const t of bad) {
      await expect(listKb(t)).rejects.toThrow(/invalid tenant id/);
    }
    expect(ddb.commandCalls(QueryCommand).length).toBe(0);
  });

  // sessionId is the other half of the composite key — the admin transcript
  // route takes it from a raw URL path segment, so it must be guarded too.
  it("getTranscript rejects a malformed sessionId before any DDB call", async () => {
    const { getTranscript } = await import("./lib/admin-ddb.js");
    for (const s of ["*", "a#b", "SESSION#x", "a/b", ""]) {
      await expect(getTranscript("tenant_a", s)).rejects.toThrow(
        /invalid session id/
      );
    }
    expect(ddb.commandCalls(QueryCommand).length).toBe(0);
  });

  it("queryHistory rejects a malformed sessionId before any DDB call", async () => {
    const { queryHistory } = await import("./lib/ddb.js");
    for (const s of ["*", "a#b", "a b"]) {
      await expect(queryHistory("tenant_a", s)).rejects.toThrow(
        /invalid session id/
      );
    }
    expect(ddb.commandCalls(QueryCommand).length).toBe(0);
  });
});
