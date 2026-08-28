import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { tenantPk, configSk, siteKeyGsi } from "@platform/shared";
import { hashSiteKey } from "@platform/shared/node";

const TABLE = process.env.TABLE_NAME ?? "platform-dev";
const TENANT_ID = process.env.SEED_TENANT_ID ?? "t_dev";
const SITE_KEY = process.env.SEED_SITE_KEY ?? "pk_live_devtenant000001";
const ORIGINS = (
  process.env.SEED_ORIGINS ??
  "http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173"
).split(",");

async function main(): Promise<void> {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const siteKeyHash = hashSiteKey(SITE_KEY);
  await client.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: tenantPk(TENANT_ID),
        SK: configSk(),
        ...siteKeyGsi(siteKeyHash),
        tenantId: TENANT_ID,
        siteKeyHash,
        allowedOrigins: ORIGINS,
        status: "active",
        branding: {
          displayName: "Dev Bot",
          greeting: "Hi! How can I help?",
          color: "#4f46e5"
        }
      }
    })
  );
  console.log(
    `Seeded tenant ${TENANT_ID} into ${TABLE}. Site key: ${SITE_KEY}`
  );
  console.log(`Allowed origins: ${ORIGINS.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
