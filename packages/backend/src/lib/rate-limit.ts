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
  const window = Math.floor(nowMs / 1000 / limit.windowSec);
  const sk = `${skPrefix}#${window}`;
  const ttl = (window + 2) * limit.windowSec;
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
