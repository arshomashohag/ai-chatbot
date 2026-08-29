import { describe, it, expect, beforeEach, vi } from "vitest";

// Origin-binding check (finding 1.2): the chat handler must reject a token
// replayed from an origin other than the one it was minted for. We stub the
// JWT verifier to return fixed claims and assert only the origin gate here;
// the full chat-handler suite (killswitch/429/degrade/happy-path) is U9.

const verifyMock = vi.fn();
vi.mock("../lib/jwt-verify.js", () => ({
  verifyWidgetJwt: (...args: unknown[]) => verifyMock(...args),
  JwtError: class JwtError extends Error {}
}));
// Prevent the handler from reaching DDB/model if the origin check ever passes
// unexpectedly — cachedTenantConfig returning a killSwitch short-circuits.
vi.mock("../lib/config-cache.js", () => ({
  cachedTenantConfig: vi.fn().mockResolvedValue({ killSwitch: true })
}));

const { handler } = await import("./chat.js");
const ctx = {} as never;
const cb = (() => {}) as never;

function invoke(origin: string) {
  return handler(
    {
      headers: { authorization: "Bearer x.y.z", origin },
      body: JSON.stringify({ message: "hi" })
    } as never,
    ctx,
    cb
  ) as Promise<{ statusCode: number; body: string }>;
}

describe("chat handler origin binding (1.2)", () => {
  beforeEach(() => {
    verifyMock.mockReset();
    process.env.JWT_KMS_KEY_ID = "key-1";
    verifyMock.mockResolvedValue({
      tenant_id: "t1",
      session_id: "s1",
      origin: "https://shop.example.com",
      iss: "chatbot-widget",
      aud: "chatbot-chat-api",
      iat: 0,
      exp: 9999999999
    });
  });

  it("rejects (401) when the request Origin differs from the token's origin", async () => {
    const res = await invoke("https://evil.example.com");
    expect(res.statusCode).toBe(401);
  });

  it("rejects (401) when the request has no Origin header", async () => {
    const res = await invoke("");
    expect(res.statusCode).toBe(401);
  });

  it("passes the origin gate when origins match (then hits killswitch 503)", async () => {
    // Matching origin → the origin gate is passed, so we reach the config check,
    // which returns killSwitch:true → 503. Proves the gate did NOT 401.
    const res = await invoke("https://shop.example.com");
    expect(res.statusCode).toBe(503);
  });
});
