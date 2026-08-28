import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  PutCommand
} from "@aws-sdk/lib-dynamodb";
import { handler } from "./admin.js";
import { userPk, profileSk, tenantPk } from "@platform/shared";

const ddb = mockClient(DynamoDBDocumentClient);

function evt(method: string, path: string, sub: string | undefined, body?: unknown) {
  return {
    rawPath: path,
    body: body ? JSON.stringify(body) : undefined,
    requestContext: {
      http: { method },
      authorizer: sub ? { jwt: { claims: { sub } } } : {}
    }
  } as never;
}

const ctx = {} as never;
const cb = (() => {}) as never;

describe("admin handler", () => {
  beforeEach(() => {
    ddb.reset();
    process.env.TABLE_NAME = "platform-test";
    process.env.ENV = "dev";
    process.env.CDN_ORIGIN = "cdn.example.com";
    process.env.CHAT_ORIGIN = "chat.example.com";
    process.env.API_ORIGIN = "chatbot-api-dev.example.com";
  });

  it("rejects a request with no Cognito sub", async () => {
    const res = await handler(evt("GET", "/v1/admin/config", undefined), ctx, cb);
    expect((res as { statusCode: number }).statusCode).toBe(403);
  });

  it("derives tenant from the caller's sub, not from the body", async () => {
    ddb.on(GetCommand).resolves({ Item: {} });
    ddb.on(GetCommand, { Key: { PK: userPk("sub_a"), SK: profileSk() } }).resolves({
      Item: { tenantId: "t_a" }
    });
    ddb.on(QueryCommand).resolves({ Items: [] });
    const res = await handler(
      evt("GET", "/v1/admin/config", "sub_a", { tenantId: "t_victim" }),
      ctx,
      cb
    );
    expect((res as { statusCode: number }).statusCode).toBe(200);
    // The config read must be for t_a (derived), never t_victim.
    const gets = ddb.commandCalls(GetCommand);
    const configGet = gets.find(
      (g) => (g.args[0].input.Key!.SK as string) === "CONFIG"
    );
    expect(configGet!.args[0].input.Key!.PK).toBe(tenantPk("t_a"));
  });

  it("refuses key issuance when setup is incomplete", async () => {
    ddb.on(GetCommand).resolves({ Item: { allowedOrigins: [] } });
    ddb.on(GetCommand, { Key: { PK: userPk("s"), SK: profileSk() } }).resolves({
      Item: { tenantId: "t1" }
    });
    ddb.on(QueryCommand).resolves({ Items: [] });
    const res = await handler(evt("POST", "/v1/admin/key", "s"), ctx, cb);
    const r = res as { statusCode: number; body: string };
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error.code).toBe("setup_incomplete");
  });

  it("issues a key (plaintext once) when setup is complete", async () => {
    ddb.on(GetCommand).resolves({
      Item: {
        basics: { allowedDomains: ["https://shop.example.com"] },
        businessProfile: "We sell hats."
      }
    });
    ddb.on(GetCommand, { Key: { PK: userPk("s"), SK: profileSk() } }).resolves({
      Item: { tenantId: "t1" }
    });
    ddb.on(QueryCommand).resolves({
      Items: [{ id: "k1", type: "faq", title: "t", body: "b", enabled: true }]
    });
    ddb.on(UpdateCommand).resolves({});
    ddb.on(PutCommand).resolves({});
    const res = await handler(evt("POST", "/v1/admin/key", "s"), ctx, cb);
    const r = res as { statusCode: number; body: string };
    expect(r.statusCode).toBe(200);
    const parsed = JSON.parse(r.body);
    expect(parsed.siteKey.startsWith("pk_live_")).toBe(true);
    expect(parsed.snippet).toContain("data-site-key");
    expect(parsed.snippet).toContain(
      'data-api-base="https://chatbot-api-dev.example.com"'
    );
    // Confirm the stored value is a hash, never the plaintext.
    const update = ddb
      .commandCalls(UpdateCommand)
      .find((u) => ":h" in (u.args[0].input.ExpressionAttributeValues ?? {}));
    const vals = update!.args[0].input.ExpressionAttributeValues!;
    expect(vals[":h"]).not.toBe(parsed.siteKey);
    expect((vals[":h"] as string).length).toBe(64);
  });
});
