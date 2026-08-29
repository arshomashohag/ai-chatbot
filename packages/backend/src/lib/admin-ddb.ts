import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand
} from "@aws-sdk/lib-dynamodb";
import { ulid } from "./ulid.js";
import { DEFAULT_MONTHLY_MESSAGE_LIMIT } from "./ddb.js";
import {
  userPk,
  profileSk,
  tenantPk,
  configSk,
  kbSk,
  sessionPk,
  siteKeyGsi,
  usageSk,
  KB_MAX_ENTRIES,
  assertTenantId,
  assertSessionId,
  type KbEntry,
  type UsageResponse,
  type KbEntryInput,
  type BusinessBasics,
  type Appearance,
  type SessionSummary,
  type StoredMessage
} from "@platform/shared";
import { hashSiteKey } from "@platform/shared/node";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

function tableName(): string {
  const name = process.env.TABLE_NAME;
  if (!name) throw new Error("TABLE_NAME env var is required");
  return name;
}

export async function getUserTenantId(sub: string): Promise<string | null> {
  const res = await client.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: userPk(sub), SK: profileSk() }
    })
  );
  return (res.Item?.tenantId as string) ?? null;
}

/**
 * Provision a user's profile + tenant config. Idempotent under partial
 * failure: the CONFIG put is attempted independently of the profile check, so
 * a Cognito trigger retry that runs after the profile was written (but before
 * the config was) still creates the missing config instead of returning early
 * and leaving the user pointed at a nonexistent tenant.
 */
export async function ensureUserTenant(
  sub: string,
  email: string
): Promise<string> {
  const existing = await getUserTenantId(sub);
  // Reuse an existing tenantId if the profile is already present; otherwise
  // mint one. Either way we still ensure the CONFIG exists below.
  const tenantId = existing ?? `t_${ulid().toLowerCase()}`;

  if (!existing) {
    try {
      await client.send(
        new PutCommand({
          TableName: tableName(),
          Item: { PK: userPk(sub), SK: profileSk(), tenantId, email },
          ConditionExpression: "attribute_not_exists(PK)"
        })
      );
    } catch (e) {
      // A concurrent invocation already wrote the profile; re-read its tenantId
      // so we ensure the config for the winning tenant, not a discarded one.
      if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
        const winner = await getUserTenantId(sub);
        if (winner) return ensureTenantConfig(winner);
      }
      throw e;
    }
  }

  return ensureTenantConfig(tenantId);
}

/**
 * Create the tenant CONFIG item if absent. Swallows the conditional-check
 * failure so repeated calls are a safe no-op (idempotent).
 */
async function ensureTenantConfig(tenantId: string): Promise<string> {
  assertTenantId(tenantId);
  try {
    await client.send(
      new PutCommand({
        TableName: tableName(),
        Item: {
          PK: tenantPk(tenantId),
          SK: configSk(),
          tenantId,
          status: "active",
          killSwitch: false,
          model: "claude-haiku-4-5",
          allowedOrigins: [],
          setupComplete: false,
          branding: {
            displayName: "Assistant",
            greeting: "Hi! How can I help?",
            color: "#6d5ae6"
          }
        },
        ConditionExpression: "attribute_not_exists(PK)"
      })
    );
  } catch (e) {
    if ((e as { name?: string }).name !== "ConditionalCheckFailedException") {
      throw e;
    }
  }
  return tenantId;
}

export interface FullConfig {
  basics?: BusinessBasics;
  appearance?: Appearance;
  businessProfile?: string;
  allowedOrigins: string[];
  hasKey: boolean;
}

export async function getConfig(tenantId: string): Promise<FullConfig> {
  assertTenantId(tenantId);
  const res = await client.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: tenantPk(tenantId), SK: configSk() }
    })
  );
  const item = res.Item ?? {};
  return {
    basics: item.basics as BusinessBasics | undefined,
    appearance: item.appearance as Appearance | undefined,
    businessProfile: item.businessProfile as string | undefined,
    allowedOrigins: (item.allowedOrigins as string[]) ?? [],
    hasKey: Boolean(item.siteKeyHash)
  };
}

export async function saveBasics(
  tenantId: string,
  basics: BusinessBasics
): Promise<void> {
  assertTenantId(tenantId);
  await client.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: tenantPk(tenantId), SK: configSk() },
      UpdateExpression: "SET basics = :b, allowedOrigins = :o",
      ExpressionAttributeValues: {
        ":b": basics,
        ":o": basics.allowedDomains
      }
    })
  );
}

export async function saveAppearance(
  tenantId: string,
  appearance: Appearance
): Promise<void> {
  assertTenantId(tenantId);
  await client.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: tenantPk(tenantId), SK: configSk() },
      UpdateExpression: "SET appearance = :a, branding = :b",
      ExpressionAttributeValues: {
        ":a": appearance,
        ":b": {
          displayName: appearance.displayName,
          greeting: appearance.greeting,
          color: appearance.color
        }
      }
    })
  );
}

export async function saveBusinessProfile(
  tenantId: string,
  profile: string
): Promise<void> {
  assertTenantId(tenantId);
  await client.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: tenantPk(tenantId), SK: configSk() },
      UpdateExpression: "SET businessProfile = :p",
      ExpressionAttributeValues: { ":p": profile }
    })
  );
}

export async function listKb(tenantId: string): Promise<KbEntry[]> {
  assertTenantId(tenantId);
  const res = await client.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": tenantPk(tenantId), ":sk": "KB#" }
    })
  );
  return (res.Items ?? []).map((i) => ({
    id: i.id as string,
    type: i.type as KbEntry["type"],
    title: i.title as string,
    body: i.body as string,
    enabled: (i.enabled as boolean) ?? true
  }));
}

export async function addKb(
  tenantId: string,
  entry: KbEntryInput
): Promise<KbEntry> {
  assertTenantId(tenantId);
  const existing = await listKb(tenantId);
  if (existing.length >= KB_MAX_ENTRIES) {
    throw new Error("kb_limit_reached");
  }
  const id = ulid();
  await client.send(
    new PutCommand({
      TableName: tableName(),
      Item: { PK: tenantPk(tenantId), SK: kbSk(id), id, ...entry }
    })
  );
  return { id, ...entry };
}

export async function deleteKb(tenantId: string, id: string): Promise<void> {
  assertTenantId(tenantId);
  await client.send(
    new DeleteCommand({
      TableName: tableName(),
      Key: { PK: tenantPk(tenantId), SK: kbSk(id) }
    })
  );
}

export async function issueSiteKey(
  tenantId: string,
  plaintext: string,
  graceSeconds: number
): Promise<void> {
  assertTenantId(tenantId);
  const hash = hashSiteKey(plaintext);
  const now = Math.floor(Date.now() / 1000);

  const current = await client.send(
    new GetCommand({
      TableName: tableName(),
      Key: { PK: tenantPk(tenantId), SK: configSk() }
    })
  );
  const oldHash = current.Item?.siteKeyHash as string | undefined;

  // Keep the previous key resolvable during the grace period via a separate
  // GSI pointer item that TTL-expires. The GSI item carries tenantId so the
  // session lookup resolves it exactly like the CONFIG item.
  if (oldHash && oldHash !== hash) {
    const g = siteKeyGsi(oldHash);
    await client.send(
      new PutCommand({
        TableName: tableName(),
        Item: {
          PK: tenantPk(tenantId),
          SK: `GRACEKEY#${oldHash}`,
          tenantId,
          siteKeyHash: oldHash,
          GSI1PK: g.GSI1PK,
          GSI1SK: g.GSI1SK,
          ttl: now + graceSeconds
        }
      })
    );
  }

  const g = siteKeyGsi(hash);
  await client.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { PK: tenantPk(tenantId), SK: configSk() },
      UpdateExpression:
        "SET siteKeyHash = :h, GSI1PK = :g, GSI1SK = :s, setupComplete = :done",
      ExpressionAttributeValues: {
        ":h": hash,
        ":g": g.GSI1PK,
        ":s": g.GSI1SK,
        ":done": true
      }
    })
  );
}

/**
 * Usage summary for the portal Overview: this month's message count, the
 * effective monthly limit, and the number of sessions. All tenant-scoped.
 */
export async function getUsageSummary(
  tenantId: string,
  month: string
): Promise<UsageResponse> {
  assertTenantId(tenantId);
  const [usage, config, sessions] = await Promise.all([
    client.send(
      new GetCommand({
        TableName: tableName(),
        Key: { PK: tenantPk(tenantId), SK: usageSk(month) }
      })
    ),
    client.send(
      new GetCommand({
        TableName: tableName(),
        Key: { PK: tenantPk(tenantId), SK: configSk() }
      })
    ),
    client.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: {
          ":pk": tenantPk(tenantId),
          ":sk": "SESSION#"
        },
        Select: "COUNT"
      })
    )
  ]);
  const configured = config.Item?.monthlyMessageLimit as number | undefined;
  const limit =
    configured && configured > 0 ? configured : DEFAULT_MONTHLY_MESSAGE_LIMIT;
  return {
    month,
    messages: (usage.Item?.messages as number | undefined) ?? 0,
    limit,
    sessions: sessions.Count ?? 0
  };
}

export async function listSessions(
  tenantId: string,
  limit = 50
): Promise<SessionSummary[]> {
  assertTenantId(tenantId);
  const res = await client.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": tenantPk(tenantId),
        ":sk": "SESSION#"
      },
      Limit: limit,
      ScanIndexForward: false
    })
  );
  return (res.Items ?? []).map((i) => ({
    sessionId: (i.SK as string).replace("SESSION#", ""),
    origin: (i.origin as string) ?? "",
    createdAt: (i.createdAt as number) ?? 0,
    messageCount: (i.messageCount as number) ?? 0
  }));
}

export async function getTranscript(
  tenantId: string,
  sessionId: string
): Promise<StoredMessage[]> {
  assertTenantId(tenantId);
  assertSessionId(sessionId);
  const res = await client.send(
    new QueryCommand({
      TableName: tableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": sessionPk(tenantId, sessionId),
        ":sk": "MSG#"
      }
    })
  );
  return (res.Items ?? []).map((i) => ({
    role: i.role,
    content: i.content,
    toolCalls: i.toolCalls,
    toolCallId: i.toolCallId
  })) as StoredMessage[];
}
