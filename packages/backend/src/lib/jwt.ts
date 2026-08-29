import { KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { JWT_ALG, type WidgetClaims } from "@platform/shared";

const kms = new KMSClient({});

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function derToJoseEs256(der: Uint8Array): Buffer {
  let offset = 2;
  if (der[1]! & 0x80) offset += der[1]! & 0x7f;
  const readInt = (): Buffer => {
    if (der[offset] !== 0x02) throw new Error("bad DER integer");
    const len = der[offset + 1]!;
    let start = offset + 2;
    let vlen = len;
    while (vlen > 0 && der[start] === 0x00) {
      start += 1;
      vlen -= 1;
    }
    const val = Buffer.from(der.slice(start, start + vlen));
    offset = offset + 2 + len;
    return val;
  };
  const r = readInt();
  const s = readInt();
  const out = Buffer.alloc(64);
  r.copy(out, 32 - r.length);
  s.copy(out, 64 - s.length);
  return out;
}

export async function signWidgetJwt(
  claims: WidgetClaims,
  keyId: string
): Promise<string> {
  // `kid` binds the token to the signing key so the verifier can select the
  // right public key and reject tokens from any other key (safe rotation).
  const header = b64url(
    JSON.stringify({ alg: JWT_ALG, typ: "JWT", kid: keyId })
  );
  const payload = b64url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const res = await kms.send(
    new SignCommand({
      KeyId: keyId,
      Message: Buffer.from(signingInput),
      MessageType: "RAW",
      SigningAlgorithm: "ECDSA_SHA_256"
    })
  );
  if (!res.Signature) throw new Error("KMS returned no signature");
  const jose = derToJoseEs256(res.Signature);
  return `${signingInput}.${b64url(jose)}`;
}
