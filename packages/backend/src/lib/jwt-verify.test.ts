import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { mockClient } from "aws-sdk-client-mock";
import { KMSClient, GetPublicKeyCommand, SignCommand } from "@aws-sdk/client-kms";
import { generateKeyPairSync, createSign } from "node:crypto";
import { JWT_ISS, JWT_AUD } from "@platform/shared";
import { signWidgetJwt } from "./jwt.js";
import { verifyWidgetJwt, JwtError } from "./jwt-verify.js";

const kms = mockClient(KMSClient);
const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256"
});
const spkiDer = publicKey.export({ format: "der", type: "spki" });

// A second, unrelated keypair for cross-key rejection.
const other = generateKeyPairSync("ec", { namedCurve: "P-256" });
const otherSpki = other.publicKey.export({ format: "der", type: "spki" });

function claims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    tenant_id: "t1",
    session_id: "s1",
    origin: "https://a.com",
    iss: JWT_ISS,
    aud: JWT_AUD,
    iat: now,
    exp: now + 3600,
    ...overrides
  };
}

function signWith(key: typeof privateKey) {
  kms.on(SignCommand).callsFake((input) => {
    const s = createSign("SHA256");
    s.update(input.Message as Buffer);
    return {
      Signature: new Uint8Array(s.sign({ key, dsaEncoding: "der" }))
    };
  });
}

async function sign(
  overrides: Record<string, unknown> = {},
  keyId = "key-1"
): Promise<string> {
  signWith(privateKey);
  return signWidgetJwt(claims(overrides) as never, keyId);
}

describe("verifyWidgetJwt", () => {
  beforeEach(() => {
    kms.reset();
    kms.on(GetPublicKeyCommand).resolves({ PublicKey: new Uint8Array(spkiDer) });
  });

  it("verifies a valid token and returns claims", async () => {
    const token = await sign();
    const c = await verifyWidgetJwt(token, "key-1");
    expect(c.tenant_id).toBe("t1");
    expect(c.origin).toBe("https://a.com");
  });

  it("rejects an expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await sign({ exp: now - 10, iat: now - 20 });
    await expect(verifyWidgetJwt(token, "key-1")).rejects.toBeInstanceOf(
      JwtError
    );
  });

  it("rejects a token whose ttl exceeds the 60m cap", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await sign({ iat: now, exp: now + 7200 });
    await expect(verifyWidgetJwt(token, "key-1")).rejects.toThrow(
      "ttl too long"
    );
  });

  it("rejects a tampered payload", async () => {
    const token = await sign();
    const [h, , s] = token.split(".");
    const forged = `${h}.${Buffer.from('{"tenant_id":"t2"}').toString(
      "base64url"
    )}.${s}`;
    await expect(verifyWidgetJwt(forged, "key-1")).rejects.toBeInstanceOf(
      JwtError
    );
  });

  it("rejects a token whose alg is not ES256", async () => {
    const badHeader = Buffer.from('{"alg":"none","typ":"JWT"}').toString(
      "base64url"
    );
    const token = `${badHeader}.e30.AAAA`;
    await expect(verifyWidgetJwt(token, "key-1")).rejects.toThrow(
      "unexpected alg"
    );
  });

  // --- U2 hardening ---

  it("rejects when the kid does not match the configured keyId (1.4)", async () => {
    const token = await sign({}, "key-A");
    await expect(verifyWidgetJwt(token, "key-B")).rejects.toThrow(
      "unexpected kid"
    );
  });

  it("rejects a wrong issuer (1.4)", async () => {
    const token = await sign({ iss: "evil" });
    await expect(verifyWidgetJwt(token, "key-1")).rejects.toThrow(
      "bad issuer"
    );
  });

  it("rejects a wrong audience (1.4)", async () => {
    const token = await sign({ aud: "some-other-api" });
    await expect(verifyWidgetJwt(token, "key-1")).rejects.toThrow(
      "bad audience"
    );
  });

  it("rejects a token signed by a different key even if kid matches (1.4)", async () => {
    // Sign with `other` private key but claim kid=key-1; verifier fetches the
    // real key-1 public key → signature check fails.
    signWith(other.privateKey);
    const token = await signWidgetJwt(claims() as never, "key-1");
    await expect(verifyWidgetJwt(token, "key-1")).rejects.toThrow(
      "bad signature"
    );
  });

  it("caches public keys per keyId (no cross-key reuse)", async () => {
    // key-1 → real key; key-2 → the OTHER key. A token from key-2 must verify
    // against key-2's public key, proving the cache is keyed by keyId.
    kms.on(GetPublicKeyCommand).callsFake((input) => ({
      PublicKey:
        input.KeyId === "key-2"
          ? new Uint8Array(otherSpki)
          : new Uint8Array(spkiDer)
    }));
    signWith(other.privateKey);
    const token2 = await signWidgetJwt(claims() as never, "key-2");
    const c = await verifyWidgetJwt(token2, "key-2");
    expect(c.tenant_id).toBe("t1");
  });
});

describe("DER→JOSE round-trip (PBT-02)", () => {
  // Signing an arbitrary message via KMS-shaped DER then verifying proves the
  // DER→JOSE conversion handles r/s of varying byte lengths (incl. 0x00 pads).
  it("property: any signed message round-trips through sign+verify", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), async (msg) => {
        kms.reset();
        kms.on(GetPublicKeyCommand).resolves({
          PublicKey: new Uint8Array(spkiDer)
        });
        signWith(privateKey);
        const token = await signWidgetJwt(claims({ session_id: msg }) as never, "key-1");
        const c = await verifyWidgetJwt(token, "key-1");
        expect(c.session_id).toBe(msg);
      }),
      { numRuns: 25 }
    );
  });
});
