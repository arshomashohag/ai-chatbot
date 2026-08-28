import { describe, it, expect } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { createSign, generateKeyPairSync, createVerify } from "node:crypto";
import { signWidgetJwt } from "./jwt.js";
import { JWT_ALG } from "@platform/shared";

const kms = mockClient(KMSClient);

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256"
});

describe("KMS ES256 JWT", () => {
  it("produces a JWS that verifies with the EC public key", async () => {
    kms.reset();
    kms.on(SignCommand).callsFake((input) => {
      const sign = createSign("SHA256");
      sign.update(input.Message as Buffer);
      const der = sign.sign({ key: privateKey, dsaEncoding: "der" });
      return { Signature: new Uint8Array(der) };
    });

    const now = Math.floor(Date.now() / 1000);
    const token = await signWidgetJwt(
      {
        tenant_id: "t1",
        session_id: "s1",
        origin: "https://a.com",
        iat: now,
        exp: now + 3600
      },
      "key-1"
    );

    const [h, p, sig] = token.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString()).alg).toBe(
      JWT_ALG
    );

    const raw = Buffer.from(sig!, "base64url");
    expect(raw.length).toBe(64);

    const verify = createVerify("SHA256");
    verify.update(`${h}.${p}`);
    const ok = verify.verify(
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      raw
    );
    expect(ok).toBe(true);
  });
});
