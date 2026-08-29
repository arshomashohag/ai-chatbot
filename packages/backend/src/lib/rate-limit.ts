import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

function tableName(): string {
  const name = process.env.TABLE_NAME;
  if (!name) throw new Error("TABLE_NAME env var is required");
  return name;
}

export interface Limit {
  max: number;
  windowSec: number;
}

export const SESSION_LIMIT: Limit = { max: 10, windowSec: 60 };
export const TENANT_LIMIT: Limit = { max: 600, windowSec: 60 };

/**
 * Atomic fixed-window counter. Increments the counter for the current window
 * and returns false (throttled) once it exceeds `limit.max`. The conditional
 * update rejects the increment when the counter is already at the cap, so
 * concurrent invocations cannot exceed it. Windows auto-expire via TTL.
 */
export async function allow(
  pk: string,
  skPrefix: string,
  limit: Limit,
  nowMs: number
): Promise<boolean> {
  const nowSec = Math.floor(nowMs / 1000);
  const window = Math.floor(nowSec / limit.windowSec);
  const sk = `${skPrefix}#${window}`;
  // TTL as an explicit epoch-seconds value ~2 windows ahead. (The old
  // `(window + 2) * windowSec` only equalled this by the window-index≈epoch
  // coincidence and broke for other windowSec values.)
  const ttl = nowSec + limit.windowSec * 2;
  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { PK: pk, SK: sk },
        UpdateExpression: "ADD #c :one SET #ttl = :ttl",
        ConditionExpression: "attribute_not_exists(#c) OR #c < :max",
        ExpressionAttributeNames: { "#c": "count", "#ttl": "ttl" },
        ExpressionAttributeValues: { ":one": 1, ":max": limit.max, ":ttl": ttl }
      })
    );
    return true;
  } catch (e) {
    if ((e as { name?: string }).name === "ConditionalCheckFailedException") {
      return false;
    }
    throw e;
  }
}

/**
 * Like `allow`, but on an infrastructure error (throttle/timeout — anything
 * other than the cap being hit) it FAILS OPEN and returns true. The rate
 * limiter is an abuse dampener, not a security boundary: its unavailability
 * must not deny service. Spend is independently bounded by the monthly quota
 * (which fails closed). A genuine cap hit still returns false (throttled).
 */
export async function allowFailOpen(
  pk: string,
  skPrefix: string,
  limit: Limit,
  nowMs: number
): Promise<boolean> {
  try {
    return await allow(pk, skPrefix, limit, nowMs);
  } catch (e) {
    console.warn(
      JSON.stringify({
        event: "rate_limit_degraded",
        sk: skPrefix,
        error: e instanceof Error ? e.message : "unknown"
      })
    );
    return true;
  }
}
