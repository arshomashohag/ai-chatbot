import { KMSClient, GetPublicKeyCommand } from "@aws-sdk/client-kms";
import { createPublicKey, createVerify, type KeyObject } from "node:crypto";
import {
  WidgetClaims,
  JWT_ALG,
  JWT_ISS,
  JWT_AUD,
  MAX_SESSION_TTL_SECONDS
} from "@platform/shared";

const kms = new KMSClient({});

// Cache public keys BY keyId with a TTL. A single global cache (the old bug)
// returned the first-ever key for every keyId, so KMS rotation silently broke
// verification for warm containers and revocation was defeated.
const KEY_CACHE_TTL_MS = 10 * 60 * 1000;
const keyCache = new Map<string, { key: KeyObject; fetchedAt: number }>();

async function publicKey(keyId: string, nowMs: number): Promise<KeyObject> {
  const hit = keyCache.get(keyId);
  if (hit && nowMs - hit.fetchedAt < KEY_CACHE_TTL_MS) return hit.key;
  const res = await kms.send(new GetPublicKeyCommand({ KeyId: keyId }));
  if (!res.PublicKey) throw new Error("KMS returned no public key");
  const key = createPublicKey({
    key: Buffer.from(res.PublicKey),
    format: "der",
    type: "spki"
  });
  keyCache.set(keyId, { key, fetchedAt: nowMs });
  return key;
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

  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(b64urlToBuf(h).toString());
  } catch {
    throw new JwtError("bad header");
  }
  if (header.alg !== JWT_ALG) throw new JwtError("unexpected alg");
  // The token must name the key it was signed with, and it must be the key this
  // verifier is configured for — blocks a token signed by any other key.
  if (header.kid !== keyId) throw new JwtError("unexpected kid");

  const nowMs = Date.now();
  const key = await publicKey(keyId, nowMs);
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

  // Bind the token to this issuer + audience.
  if (parsed.data.iss !== JWT_ISS) throw new JwtError("bad issuer");
  if (parsed.data.aud !== JWT_AUD) throw new JwtError("bad audience");

  const now = Math.floor(nowMs / 1000);
  if (parsed.data.exp <= now) throw new JwtError("token expired");
  if (parsed.data.exp - parsed.data.iat > MAX_SESSION_TTL_SECONDS) {
    throw new JwtError("ttl too long");
  }

  return parsed.data;
}
