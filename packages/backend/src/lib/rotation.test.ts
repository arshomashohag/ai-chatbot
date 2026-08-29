import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand
} from "@aws-sdk/lib-dynamodb";
import { hashSiteKey } from "@platform/shared/node";
import { issueSiteKey } from "./admin-ddb.js";
import { findTenantBySiteKeyHash } from "./ddb.js";

const ddb = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddb.reset();
  process.env.TABLE_NAME = "platform-test";
});

describe("site-key rotation (3.29)", () => {
  it("writes a grace pointer for the OLD key and updates CONFIG to the NEW key", async () => {
    const oldHash = hashSiteKey("pk_live_old");
    // Current CONFIG has the old key.
    ddb.on(GetCommand).resolves({
      Item: { PK: "TENANT#t1", SK: "CONFIG", siteKeyHash: oldHash }
    });
    ddb.on(PutCommand).resolves({});
    ddb.on(UpdateCommand).resolves({});

    await issueSiteKey("t1", "pk_live_new", 24 * 60 * 60);

    const gracePut = ddb
      .commandCalls(PutCommand)
      .map((c) => c.args[0].input)
      .find((i) => (i.Item!.SK as string).startsWith("GRACEKEY#"));
    expect(gracePut).toBeTruthy();
    expect(gracePut!.Item!.siteKeyHash).toBe(oldHash);
    expect(gracePut!.Item!.tenantId).toBe("t1");
    expect(typeof gracePut!.Item!.ttl).toBe("number"); // TTL set

    const update = ddb.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(update.ExpressionAttributeValues![":h"]).toBe(hashSiteKey("pk_live_new"));
  });

  it("does NOT write a grace pointer when the key is unchanged (no-op rotation)", async () => {
    const sameHash = hashSiteKey("pk_live_same");
    ddb.on(GetCommand).resolves({
      Item: { PK: "TENANT#t1", SK: "CONFIG", siteKeyHash: sameHash }
    });
    ddb.on(PutCommand).resolves({});
    ddb.on(UpdateCommand).resolves({});

    await issueSiteKey("t1", "pk_live_same", 24 * 60 * 60);

    const gracePut = ddb
      .commandCalls(PutCommand)
      .map((c) => c.args[0].input)
      .find((i) => (i.Item!.SK as string)?.startsWith("GRACEKEY#"));
    expect(gracePut).toBeUndefined();
  });
});

describe("grace-key lookup (3.29)", () => {
  it("resolves the OLD key during grace to the correct tenant's CONFIG", async () => {
    const oldHash = hashSiteKey("pk_live_old");
    // The GSI query returns the grace pointer (carries only tenantId + SK GRACEKEY#).
    ddb.on(QueryCommand).resolves({
      Items: [{ SK: `GRACEKEY#${oldHash}`, tenantId: "t1" }]
    });
    // findTenantBySiteKeyHash then re-reads the authoritative CONFIG.
    ddb.on(GetCommand).resolves({
      Item: {
        PK: "TENANT#t1",
        SK: "CONFIG",
        tenantId: "t1",
        siteKeyHash: hashSiteKey("pk_live_new"),
        allowedOrigins: ["https://a.com"],
        status: "active",
        branding: { displayName: "A", greeting: "hi", color: "#000" }
      }
    });

    const cfg = await findTenantBySiteKeyHash(oldHash);
    expect(cfg?.tenantId).toBe("t1");
    // Resolved via the authoritative CONFIG (a Get after the GSI query).
    expect(ddb.commandCalls(GetCommand).length).toBeGreaterThanOrEqual(1);
    const getPk = ddb.commandCalls(GetCommand)[0]!.args[0].input.Key!.PK;
    expect(getPk).toBe("TENANT#t1"); // never tenant-guessable; scoped to t1
  });

  it("returns null when no site key (or grace key) matches", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    expect(await findTenantBySiteKeyHash("deadbeef")).toBeNull();
  });
});
