import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand
} from "@aws-sdk/lib-dynamodb";
import { siteKeyGsi, tenantPk, configSk } from "@platform/shared";

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
  return {
    tenantId: item.tenantId as string,
    siteKeyHash: item.siteKeyHash as string,
    allowedOrigins: (item.allowedOrigins as string[]) ?? [],
    status: (item.status as TenantConfig["status"]) ?? "active",
    branding: item.branding as TenantConfig["branding"]
  };
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
  return {
    tenantId,
    siteKeyHash: item.siteKeyHash as string,
    allowedOrigins: (item.allowedOrigins as string[]) ?? [],
    status: (item.status as TenantConfig["status"]) ?? "active",
    branding: item.branding as TenantConfig["branding"]
  };
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
