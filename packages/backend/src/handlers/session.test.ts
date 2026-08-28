import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { handler } from "./session.js";
import { SessionResponse, siteKeyGsi } from "@platform/shared";
import { hashSiteKey } from "@platform/shared/node";

const ddb = mockClient(DynamoDBDocumentClient);
const kms = mockClient(KMSClient);
const ctx = {} as never;
const cb = (() => {}) as never;

function fakeDerSig(): Uint8Array {
  const r = new Uint8Array(32).fill(0x11);
  const s = new Uint8Array(32).fill(0x22);
  return new Uint8Array([0x30, 0x44, 0x02, 0x20, ...r, 0x02, 0x20, ...s]);
}

const SITE_KEY = "pk_live_devtenant123";
const TENANT_ITEM = {
  tenantId: "t_dev",
  siteKeyHash: hashSiteKey(SITE_KEY),
  allowedOrigins: ["https://shop.example.com"],
  status: "active",
  branding: { displayName: "Bot", greeting: "Hi", color: "#000" }
};

function invoke(origin: string) {
  return handler(
    {
      headers: { origin, "user-agent": "test" },
      body: JSON.stringify({ siteKey: SITE_KEY })
    } as never,
    ctx,
    cb
  );
}

describe("session handler", () => {
  beforeEach(() => {
    ddb.reset();
    kms.reset();
    process.env.TABLE_NAME = "platform-test";
    process.env.JWT_KMS_KEY_ID = "key-abc";
    ddb.on(QueryCommand).resolves({ Items: [TENANT_ITEM] });
    ddb.on(PutCommand).resolves({});
    kms.on(SignCommand).resolves({ Signature: fakeDerSig() });
  });

  it("issues a session for an allowed origin", async () => {
    const res = await invoke("https://shop.example.com");
    if (!res || typeof res === "string") throw new Error("bad result");
    expect(res.statusCode).toBe(200);
    const parsed = SessionResponse.parse(JSON.parse(res.body as string));
    expect(parsed.token.split(".").length).toBe(3);
    expect(parsed.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects a foreign origin with 403 origin_not_allowed", async () => {
    const res = await invoke("https://evil.com");
    if (!res || typeof res === "string") throw new Error("bad result");
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body as string).error.code).toBe("origin_not_allowed");
  });

  it("queries GSI1 by the hashed site key, never plaintext", async () => {
    await invoke("https://shop.example.com");
    const call = ddb.commandCalls(QueryCommand)[0];
    const values = call!.args[0].input.ExpressionAttributeValues!;
    expect(values[":pk"]).toBe(siteKeyGsi(hashSiteKey(SITE_KEY)).GSI1PK);
    expect(JSON.stringify(values)).not.toContain(SITE_KEY);
  });

  it("returns 403 bad_site_key when tenant not found", async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    const res = await invoke("https://shop.example.com");
    if (!res || typeof res === "string") throw new Error("bad result");
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body as string).error.code).toBe("bad_site_key");
  });
});
