import { describe, it, expect, beforeEach, vi } from "vitest";

// Origin binding (finding 1.2, corrected after the cloud review): the chat POST
// is issued from INSIDE the chat iframe, so the browser sends the chat surface's
// origin — NOT the merchant origin the token was minted for. The handler
// therefore requires the request Origin to be the chat surface (rejecting a
// no-Origin server-side replay), and does NOT compare it to claims.origin (which
// would 401 every real request). The real origin allowlisting happens at session
// mint. This test guards against a regression back to the broken merchant-origin
// comparison.

const verifyMock = vi.fn();
vi.mock("../lib/jwt-verify.js", () => ({
  verifyWidgetJwt: (...args: unknown[]) => verifyMock(...args),
  JwtError: class JwtError extends Error {}
}));
vi.mock("../lib/config-cache.js", () => ({
  cachedTenantConfig: vi.fn().mockResolvedValue({ killSwitch: true }),
  evictTenantConfig: vi.fn()
}));

const { handler } = await import("./chat.js");
const ctx = {} as never;
const cb = (() => {}) as never;

const CHAT = "https://chatbot-chat-dev.example.com";
const MERCHANT = "https://shop.example.com";

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

describe("chat handler origin binding (1.2, corrected)", () => {
  beforeEach(() => {
    verifyMock.mockReset();
    process.env.JWT_KMS_KEY_ID = "key-1";
    // The chat handler compares the request Origin against its own chat surface.
    process.env.CHAT_ORIGIN = "chatbot-chat-dev.example.com";
    // The token's origin is the MERCHANT page (as minted) — deliberately
    // different from the request Origin (the chat CDN).
    verifyMock.mockResolvedValue({
      tenant_id: "t1",
      session_id: "s1",
      origin: MERCHANT,
      iss: "chatbot-widget",
      aud: "chatbot-chat-api",
      iat: 0,
      exp: 9999999999
    });
  });

  it("PASSES the origin gate for a real request from the chat surface (regression guard for the 401-everything bug)", async () => {
    // Request Origin = chat CDN (what the iframe actually sends), token origin =
    // merchant. Old code compared these and 401'd every real request. Now it
    // passes the gate → reaches the config check → killSwitch 503.
    const res = await invoke(CHAT);
    expect(res.statusCode).toBe(503); // NOT 401
  });

  it("rejects (401) a request with no Origin (server-side replay)", async () => {
    const res = await invoke("");
    expect(res.statusCode).toBe(401);
  });

  it("rejects (401) a request from an origin that is not the chat surface", async () => {
    const res = await invoke("https://evil.example.com");
    expect(res.statusCode).toBe(401);
  });
});
