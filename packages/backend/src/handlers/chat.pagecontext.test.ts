import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand
} from "@aws-sdk/lib-dynamodb";
import { hashContent } from "@platform/shared/node";
import { resolvePageContext } from "./chat.js";

const ddb = mockClient(DynamoDBDocumentClient);

const PAGE = {
  url: "https://shop.example/returns",
  title: "Returns",
  text: "Returns accepted within 30 days."
};
const HASH = hashContent(`${PAGE.title}\n${PAGE.text}`);

describe("resolvePageContext (change detection)", () => {
  beforeEach(() => {
    ddb.reset();
    process.env.TABLE_NAME = "platform-test";
    ddb.on(PutCommand).resolves({});
  });

  it("skips entirely when no page context is supplied", async () => {
    const r = await resolvePageContext("t_dev", undefined);
    expect(r.send).toBeUndefined();
    expect(r.changed).toBe(false);
  });

  it("first sight of a page: sends it, not flagged changed, and stores it", async () => {
    ddb.on(GetCommand).resolves({}); // no stored snapshot
    const r = await resolvePageContext("t_dev", PAGE);
    expect(r.send).toEqual(PAGE);
    expect(r.changed).toBe(false);
    const put = ddb.commandCalls(PutCommand);
    expect(put.length).toBe(1);
    expect(put[0]!.args[0].input.Item!.contentHash).toBe(HASH);
  });

  it("unchanged page: does NOT re-send and does NOT rewrite", async () => {
    ddb.on(GetCommand).resolves({
      Item: { contentHash: HASH, url: PAGE.url, title: PAGE.title }
    });
    const r = await resolvePageContext("t_dev", PAGE);
    expect(r.send).toBeUndefined();
    expect(r.changed).toBe(false);
    expect(ddb.commandCalls(PutCommand).length).toBe(0);
  });

  it("changed page: sends it, flagged changed, and updates the snapshot", async () => {
    ddb.on(GetCommand).resolves({
      Item: { contentHash: "stale-hash", url: PAGE.url, title: PAGE.title }
    });
    const r = await resolvePageContext("t_dev", PAGE);
    expect(r.send).toEqual(PAGE);
    expect(r.changed).toBe(true);
    expect(ddb.commandCalls(PutCommand).length).toBe(1);
  });

  it("empty snapshot (no text/title/description) is ignored", async () => {
    const r = await resolvePageContext("t_dev", { url: "https://x/" });
    expect(r.send).toBeUndefined();
    expect(ddb.commandCalls(GetCommand).length).toBe(0);
  });

  it("fails toward grounding when the DDB read errors", async () => {
    ddb.on(GetCommand).rejects(new Error("ddb down"));
    const r = await resolvePageContext("t_dev", PAGE);
    expect(r.send).toEqual(PAGE);
    expect(r.changed).toBe(false);
  });
});
