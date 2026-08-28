import {
  SecretsManagerClient,
  GetSecretValueCommand
} from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({});
let cached: string | null = null;

export async function modelApiKey(): Promise<string> {
  if (cached) return cached;
  const local = process.env.MODEL_API_KEY;
  if (local) {
    cached = local;
    return cached;
  }
  const secretId = process.env.MODEL_API_KEY_SECRET_ARN;
  if (!secretId) throw new Error("MODEL_API_KEY_SECRET_ARN is required");
  const res = await client.send(
    new GetSecretValueCommand({ SecretId: secretId })
  );
  if (!res.SecretString) throw new Error("empty model API key secret");
  cached = res.SecretString;
  return cached;
}
