import { KMSClient, GetPublicKeyCommand } from "@aws-sdk/client-kms";
import { createPublicKey, createVerify, type KeyObject } from "node:crypto";
import { WidgetClaims, JWT_ALG, MAX_SESSION_TTL_SECONDS } from "@platform/shared";

const kms = new KMSClient({});
let cachedKey: KeyObject | null = null;

async function publicKey(keyId: string): Promise<KeyObject> {
  if (cachedKey) return cachedKey;
  const res = await kms.send(new GetPublicKeyCommand({ KeyId: keyId }));
  if (!res.PublicKey) throw new Error("KMS returned no public key");
  cachedKey = createPublicKey({
    key: Buffer.from(res.PublicKey),
    format: "der",
    type: "spki"
  });
  return cachedKey;
}

function b64urlToBuf(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

export class JwtError extends Error {}

export async function verifyWidgetJwt(
  token: string,
  keyId: string
): Promise<WidgetClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtError("malformed token");
  const [h, p, sig] = parts as [string, string, string];

  let header: { alg?: string };
  try {
    header = JSON.parse(b64urlToBuf(h).toString());
  } catch {
    throw new JwtError("bad header");
  }
  if (header.alg !== JWT_ALG) throw new JwtError("unexpected alg");

  const key = await publicKey(keyId);
  const verify = createVerify("SHA256");
  verify.update(`${h}.${p}`);
  const ok = verify.verify(
    { key, dsaEncoding: "ieee-p1363" },
    b64urlToBuf(sig)
  );
  if (!ok) throw new JwtError("bad signature");

  let claims: unknown;
  try {
    claims = JSON.parse(b64urlToBuf(p).toString());
  } catch {
    throw new JwtError("bad payload");
  }
  const parsed = WidgetClaims.safeParse(claims);
  if (!parsed.success) throw new JwtError("invalid claims");

  const now = Math.floor(Date.now() / 1000);
  if (parsed.data.exp <= now) throw new JwtError("token expired");
  if (parsed.data.exp - parsed.data.iat > MAX_SESSION_TTL_SECONDS) {
    throw new JwtError("ttl too long");
  }

  return parsed.data;
}
