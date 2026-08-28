import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  BatchWriteCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import {
  siteKeyGsi,
  tenantPk,
  configSk,
  sessionPk,
  messageSk,
  usageSk
} from "@platform/shared";
import type { StoredMessage } from "@platform/shared";

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
}

const DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful store assistant. Answer concisely.";

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
    killSwitch: (item.killSwitch as boolean) ?? false
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
  return toTenantConfig(item.tenantId as string, item);
}

export async function getTenantConfig(
  tenantId: string
): Promise<TenantConfig | null> {
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
  const res = await client.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": sessionPk(tenantId, sessionId),
        ":sk": "MSG#"
      },
      Limit: limit
    })
  );
  return (res.Items ?? []).map((i) => ({
    role: i.role,
    content: i.content,
    toolCalls: i.toolCalls,
    toolCallId: i.toolCallId,
    tokensIn: i.tokensIn,
    tokensOut: i.tokensOut
  })) as StoredMessage[];
}

export async function persistMessages(params: {
  tenantId: string;
  sessionId: string;
  baseIso: string;
  messages: StoredMessage[];
}): Promise<void> {
  if (params.messages.length === 0) return;
  const items = params.messages.map((m, idx) => ({
    PutRequest: {
      Item: {
        PK: sessionPk(params.tenantId, params.sessionId),
        SK: messageSk(params.baseIso, String(idx).padStart(4, "0")),
        tenantId: params.tenantId,
        ...m
      }
    }
  }));
  await client.send(
    new BatchWriteCommand({
      RequestItems: { [tableName()]: items }
    })
  );
}

export async function incrementUsage(params: {
  tenantId: string;
  month: string;
  tokensIn: number;
  tokensOut: number;
}): Promise<void> {
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
