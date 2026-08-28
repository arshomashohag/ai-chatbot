import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  BatchWriteCommand
} from "@aws-sdk/lib-dynamodb";
import { tenantPk, configSk, siteKeyGsi, productSk } from "@platform/shared";
import { hashSiteKey } from "@platform/shared/node";

const PRODUCTS = [
  { productId: "p1", name: "Blue T-Shirt", price: 19, available: true },
  { productId: "p2", name: "Red Hoodie", price: 39, available: true },
  { productId: "p3", name: "Green Cap", price: 12, available: true },
  { productId: "p4", name: "Black Jeans", price: 49, available: false }
];

const TABLE = process.env.TABLE_NAME ?? "chatbot-platform-dev";
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
        killSwitch: false,
        model: "claude-haiku-4-5",
        systemPrompt:
          "You are a helpful store assistant. Use search_products to " +
          "answer product questions. Answer concisely.",
        branding: {
          displayName: "Dev Bot",
          greeting: "Hi! How can I help?",
          color: "#4f46e5"
        }
      }
    })
  );

  await client.send(
    new BatchWriteCommand({
      RequestItems: {
        [TABLE]: PRODUCTS.map((p) => ({
          PutRequest: {
            Item: { PK: tenantPk(TENANT_ID), SK: productSk(p.productId), ...p }
          }
        }))
      }
    })
  );

  console.log(
    `Seeded tenant ${TENANT_ID} into ${TABLE}. Site key: ${SITE_KEY}`
  );
  console.log(`Seeded ${PRODUCTS.length} products.`);
  console.log(`Allowed origins: ${ORIGINS.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
