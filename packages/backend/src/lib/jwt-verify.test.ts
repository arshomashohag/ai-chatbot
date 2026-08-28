import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { KMSClient, GetPublicKeyCommand, SignCommand } from "@aws-sdk/client-kms";
import { generateKeyPairSync } from "node:crypto";
import { signWidgetJwt } from "./jwt.js";
import { verifyWidgetJwt, JwtError } from "./jwt-verify.js";
import { createSign } from "node:crypto";

const kms = mockClient(KMSClient);
const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256"
});
const spkiDer = publicKey.export({ format: "der", type: "spki" });

function claims(exp: number) {
  return {
    tenant_id: "t1",
    session_id: "s1",
    origin: "https://a.com",
    iat: Math.floor(Date.now() / 1000),
    exp
  };
}

async function sign(exp: number): Promise<string> {
  kms.on(SignCommand).callsFake((input) => {
    const s = createSign("SHA256");
    s.update(input.Message as Buffer);
    return { Signature: new Uint8Array(s.sign({ key: privateKey, dsaEncoding: "der" })) };
  });
  return signWidgetJwt(claims(exp), "key-1");
}

describe("verifyWidgetJwt", () => {
  beforeEach(() => {
    kms.reset();
    kms.on(GetPublicKeyCommand).resolves({ PublicKey: new Uint8Array(spkiDer) });
  });

  it("verifies a valid token and returns claims", async () => {
    const token = await sign(Math.floor(Date.now() / 1000) + 3600);
    const c = await verifyWidgetJwt(token, "key-1");
    expect(c.tenant_id).toBe("t1");
    expect(c.session_id).toBe("s1");
  });

  it("rejects an expired token", async () => {
    const token = await sign(Math.floor(Date.now() / 1000) - 10);
    await expect(verifyWidgetJwt(token, "key-1")).rejects.toBeInstanceOf(JwtError);
  });

  it("rejects a token whose ttl exceeds the 60m cap", async () => {
    const now = Math.floor(Date.now() / 1000);
    kms.on(SignCommand).callsFake((input) => {
      const s = createSign("SHA256");
      s.update(input.Message as Buffer);
      return {
        Signature: new Uint8Array(s.sign({ key: privateKey, dsaEncoding: "der" }))
      };
    });
    const token = await signWidgetJwt(
      {
        tenant_id: "t1",
        session_id: "s1",
        origin: "https://a.com",
        iat: now,
        exp: now + 7200
      },
      "key-1"
    );
    await expect(verifyWidgetJwt(token, "key-1")).rejects.toThrow("ttl too long");
  });

  it("rejects a tampered payload", async () => {
    const token = await sign(Math.floor(Date.now() / 1000) + 3600);
    const [h, , s] = token.split(".");
    const forged = `${h}.${Buffer.from('{"tenant_id":"t2"}').toString("base64url")}.${s}`;
    await expect(verifyWidgetJwt(forged, "key-1")).rejects.toBeInstanceOf(JwtError);
  });

  it("rejects a token whose alg is not ES256", async () => {
    const badHeader = Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url");
    const token = `${badHeader}.e30.AAAA`;
    await expect(verifyWidgetJwt(token, "key-1")).rejects.toThrow("unexpected alg");
  });
});
