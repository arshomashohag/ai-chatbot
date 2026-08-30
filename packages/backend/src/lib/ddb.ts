import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  BatchWriteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { monotonicUlid } from "./ulid.js";
import {
  siteKeyGsi,
  tenantPk,
  configSk,
  sessionPk,
  sessionSk,
  messageSk,
  usageSk,
  siteContentSk,
  assertTenantId,
  assertSessionId
} from "@platform/shared";
import type { StoredMessage } from "@platform/shared";

// Monotonic ULIDs: lexicographically sortable and strictly increasing even
// within the same millisecond, so message sort keys never collide or reorder.
const nextMessageId = monotonicUlid();

// DynamoDB caps BatchWrite at 25 items per request.
const BATCH_MAX = 25;

/**
 * Split an array into chunks of at most `size`. Pure; property-tested.
 */
export function chunk<T>(items: readonly T[], size = BATCH_MAX): T[][] {
  if (size < 1) throw new Error("chunk size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

function tableName(): string {
  const name = process.env.TABLE_NAME;
  if (!name) throw new Error("TABLE_NAME env var is required");
  return name;
}

export interface TenantConfig {
  tenantId: string;
  siteKeyHash: string;
  allowedOrigins: string[];
  status: "active" | "suspended";
  branding: { displayName: string; greeting: string; color: string };
  model: string;
  systemPrompt: string;
  killSwitch: boolean;
  monthlyMessageLimit?: number;
  businessProfile?: string;
}

const DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful store assistant. Answer concisely.";

// Platform default monthly message ceiling per tenant. Bounds runaway model
// spend from a leaked/abused site key when a tenant has no explicit limit set.
// Far below what the 600/min rate limit alone would permit (~25M/month).
export const DEFAULT_MONTHLY_MESSAGE_LIMIT = 10_000;

function toTenantConfig(
  tenantId: string,
  item: Record<string, unknown>
): TenantConfig {
  return {
    tenantId,
    siteKeyHash: item.siteKeyHash as string,
    allowedOrigins: (item.allowedOrigins as string[]) ?? [],
    status: (item.status as TenantConfig["status"]) ?? "active",
    branding: item.branding as TenantConfig["branding"],
    model: (item.model as string) ?? DEFAULT_MODEL,
    systemPrompt: (item.systemPrompt as string) ?? DEFAULT_SYSTEM_PROMPT,
    killSwitch: (item.killSwitch as boolean) ?? false,
    monthlyMessageLimit: item.monthlyMessageLimit as number | undefined,
    businessProfile: item.businessProfile as string | undefined
  };
}

export async function findTenantBySiteKeyHash(
  siteKeyHash: string
): Promise<TenantConfig | null> {
  const { GSI1PK, GSI1SK } = siteKeyGsi(siteKeyHash);
  const res = await client.send(
    new QueryCommand({
      TableName: tableName(),
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk AND GSI1SK = :sk",
      ExpressionAttributeValues: { ":pk": GSI1PK, ":sk": GSI1SK },
      Limit: 1
    })
  );
  const item = res.Items?.[0];
  if (!item) return null;
  // A grace-key pointer item (rotation) carries only tenantId; resolve the
  // authoritative CONFIG so branding/origins/status are correct.
  if (typeof item.SK === "string" && item.SK.startsWith("GRACEKEY#")) {
    return getTenantConfig(item.tenantId as string);
  }
  return toTenantConfig(item.tenantId as string, item);
}

export async function getTenantConfig(
  tenantId: string
): Promise<TenantConfig | null> {
  assertTenantId(tenantId);
  const res = await client.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: tenantPk(tenantId), SK: configSk() }
    })
  );
  const item = res.Item;
  if (!item) return null;
  return toTenantConfig(tenantId, item);
}

export async function putSession(params: {
  tenantId: string;
  sessionId: string;
  origin: string;
  userAgent: string;
  createdAt: number;
  ttl: number;
}): Promise<void> {
  assertTenantId(params.tenantId);
  assertSessionId(params.sessionId);
  await client.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        PK: tenantPk(params.tenantId),
        SK: `SESSION#${params.sessionId}`,
        origin: params.origin,
        userAgent: params.userAgent,
        createdAt: params.createdAt,
        ttl: params.ttl
      }
    })
  );
}

export interface Product {
  productId: string;
  name: string;
  price: number;
  available: boolean;
}

export async function searchProducts(
  tenantId: string,
  query: string,
  limit = 5
): Promise<Product[]> {
  assertTenantId(tenantId);
  const res = await client.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": tenantPk(tenantId),
        ":sk": "PRODUCT#"
      },
      Limit: 200
    })
  );
  const q = query.toLowerCase();
  return (res.Items ?? [])
    .map((i) => ({
      productId: i.productId as string,
      name: i.name as string,
      price: i.price as number,
      available: (i.available as boolean) ?? true
    }))
    .filter((p) => p.name.toLowerCase().includes(q))
    .slice(0, limit);
}

export async function queryHistory(
  tenantId: string,
  sessionId: string,
  limit = 20
): Promise<StoredMessage[]> {
  assertTenantId(tenantId);
  assertSessionId(sessionId);
  // Fetch the most recent `limit` messages (ScanIndexForward:false = descending
  // sort key), then reverse to chronological order for the model. Without this
  // the query returns the OLDEST `limit` items and the bot loses recent context.
  const res = await client.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": sessionPk(tenantId, sessionId),
        ":sk": "MSG#"
      },
      ScanIndexForward: false,
      Limit: limit
    })
  );
  const newestFirst = (res.Items ?? []).map((i) => ({
    role: i.role,
    content: i.content,
    toolCalls: i.toolCalls,
    toolCallId: i.toolCallId,
    tokensIn: i.tokensIn,
    tokensOut: i.tokensOut
  })) as StoredMessage[];
  return newestFirst.reverse();
}

type WriteRequest = { PutRequest: { Item: Record<string, unknown> } };

async function batchWriteWithRetry(requests: WriteRequest[]): Promise<void> {
  const table = tableName();
  for (const group of chunk(requests)) {
    let pending: WriteRequest[] | undefined = group;
    for (let attempt = 0; attempt < 4 && pending && pending.length; attempt++) {
      const res = await client.send(
        new BatchWriteCommand({ RequestItems: { [table]: pending } })
      );
      const unprocessed = res.UnprocessedItems?.[table] as
        | WriteRequest[]
        | undefined;
      pending = unprocessed && unprocessed.length ? unprocessed : undefined;
      if (pending && pending.length) {
        // Exponential backoff before retrying throttled items.
        await new Promise((r) => setTimeout(r, 25 * 2 ** attempt));
      }
    }
    if (pending && pending.length) {
      throw new Error(
        `persistMessages: ${pending.length} items unprocessed after retries`
      );
    }
  }
}

export async function persistMessages(params: {
  tenantId: string;
  sessionId: string;
  messages: StoredMessage[];
}): Promise<void> {
  assertTenantId(params.tenantId);
  assertSessionId(params.sessionId);
  if (params.messages.length === 0) return;
  // One monotonic ULID per message → globally unique, chronologically sortable
  // sort keys. Replaces the old MSG#<iso>#<idx> scheme where same-millisecond
  // requests both wrote #0000 and silently overwrote each other.
  const requests = params.messages.map((m) => ({
    PutRequest: {
      Item: {
        PK: sessionPk(params.tenantId, params.sessionId),
        SK: messageSk(nextMessageId()),
        tenantId: params.tenantId,
        ...m
      }
    }
  }));
  await batchWriteWithRetry(requests);

  // Keep the session's messageCount truthful for the portal sessions view.
  const conversational = params.messages.filter(
    (m) => m.role === "user" || m.role === "assistant"
  ).length;
  if (conversational > 0) {
    await client.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: {
          PK: tenantPk(params.tenantId),
          SK: sessionSk(params.sessionId)
        },
        UpdateExpression: "ADD messageCount :n",
        ExpressionAttributeValues: { ":n": conversational }
      })
    );
  }
}

export async function incrementUsage(params: {
  tenantId: string;
  month: string;
  tokensIn: number;
  tokensOut: number;
}): Promise<void> {
  assertTenantId(params.tenantId);
  await client.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: tenantPk(params.tenantId), SK: usageSk(params.month) },
      UpdateExpression:
        "ADD messages :one, tokensIn :ti, tokensOut :to",
      ExpressionAttributeValues: {
        ":one": 1,
        ":ti": params.tokensIn,
        ":to": params.tokensOut
      }
    })
  );
}

/**
 * Read the tenant's message count for a month. Eventually-consistent read is
 * fine here — the goal is bounding runaway spend, not exact billing.
 */
export async function getUsage(
  tenantId: string,
  month: string
): Promise<number> {
  assertTenantId(tenantId);
  const res = await client.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: tenantPk(tenantId), SK: usageSk(month) }
    })
  );
  return (res.Item?.messages as number | undefined) ?? 0;
}

export interface StoredSiteContent {
  contentHash: string;
  url: string;
  title?: string;
}

/**
 * Read the last-known snapshot of a page (by URL hash) for a tenant. Returns
 * null the first time we ever see a page — the caller treats that as "new".
 */
export async function getSiteContent(
  tenantId: string,
  urlHash: string
): Promise<StoredSiteContent | null> {
  assertTenantId(tenantId);
  const res = await client.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: tenantPk(tenantId), SK: siteContentSk(urlHash) }
    })
  );
  const item = res.Item;
  if (!item) return null;
  return {
    contentHash: item.contentHash as string,
    url: item.url as string,
    title: item.title as string | undefined
  };
}

/**
 * Upsert a page snapshot for a tenant. We store the content hash (for change
 * detection) plus url/title for the portal; the full text is intentionally NOT
 * kept — the model receives it inline on the turn, and re-storing 12KB per page
 * per tenant buys nothing the hash doesn't.
 */
export async function putSiteContent(params: {
  tenantId: string;
  urlHash: string;
  contentHash: string;
  url: string;
  title?: string;
  updatedAt: number;
}): Promise<void> {
  assertTenantId(params.tenantId);
  await client.send(
    new PutCommand({
      TableName: tableName(),
      Item: {
        PK: tenantPk(params.tenantId),
        SK: siteContentSk(params.urlHash),
        contentHash: params.contentHash,
        url: params.url,
        title: params.title,
        updatedAt: params.updatedAt
      }
    })
  );
}

/**
 * Hard-stop a tenant by setting killSwitch=true on its CONFIG. Called when a
 * tenant crosses its monthly quota so all further chat requests short-circuit.
 * Idempotent.
 */
export async function tripKillSwitch(tenantId: string): Promise<void> {
  assertTenantId(tenantId);
  await client.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: tenantPk(tenantId), SK: configSk() },
      UpdateExpression: "SET killSwitch = :true",
      ExpressionAttributeValues: { ":true": true }
    })
  );
}
