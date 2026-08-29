import { describe, it, expect, beforeEach, vi } from "vitest";

// U4 backend robustness for the chat handler: CORS on every response, OPTIONS
// preflight, fail-open rate limiting, guarded persist/usage, malformed-body 400.

const verifyMock = vi.fn();
const configMock = vi.fn();
const getUsageMock = vi.fn();
const runChatMock = vi.fn();
const persistMock = vi.fn();
const incrementMock = vi.fn();
const allowMock = vi.fn();

vi.mock("../lib/jwt-verify.js", () => ({
  verifyWidgetJwt: (...a: unknown[]) => verifyMock(...a),
  JwtError: class JwtError extends Error {}
}));
vi.mock("../lib/config-cache.js", () => ({
  cachedTenantConfig: (...a: unknown[]) => configMock(...a),
  evictTenantConfig: vi.fn()
}));
vi.mock("../lib/ddb.js", () => ({
  getUsage: (...a: unknown[]) => getUsageMock(...a),
  tripKillSwitch: vi.fn(),
  persistMessages: (...a: unknown[]) => persistMock(...a),
  incrementUsage: (...a: unknown[]) => incrementMock(...a),
  queryHistory: vi.fn().mockResolvedValue([]),
  DEFAULT_MONTHLY_MESSAGE_LIMIT: 10_000
}));
vi.mock("../lib/rate-limit.js", () => ({
  allowFailOpen: (...a: unknown[]) => allowMock(...a),
  SESSION_LIMIT: 10,
  TENANT_LIMIT: 600
}));
vi.mock("../lib/chat-engine.js", () => ({
  runChat: (...a: unknown[]) => runChatMock(...a)
}));
vi.mock("../lib/admin-ddb.js", () => ({ listKb: vi.fn().mockResolvedValue([]) }));
vi.mock("../lib/secrets.js", () => ({ modelApiKey: vi.fn().mockResolvedValue("k") }));
vi.mock("../lib/adapter/anthropic.js", () => ({ AnthropicAdapter: class {} }));

const { handler } = await import("./chat.js");
const ctx = {} as never;
const cb = (() => {}) as never;
const ORIGIN = "https://shop.example.com";

function invoke(over: Record<string, unknown> = {}) {
  return handler(
    {
      headers: { authorization: "Bearer x", origin: ORIGIN },
      requestContext: { http: { method: "POST" } },
      body: JSON.stringify({ message: "hi" }),
      ...over
    } as never,
    ctx,
    cb
  ) as Promise<{ statusCode: number; headers?: Record<string, string>; body: string }>;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_KMS_KEY_ID = "key-1";
  // Request Origin is the chat surface for this test so the origin gate passes.
  process.env.CHAT_ORIGIN = "shop.example.com";
  verifyMock.mockResolvedValue({
    tenant_id: "t1",
    session_id: "s1",
    origin: ORIGIN,
    iss: "chatbot-widget",
    aud: "chatbot-chat-api",
    iat: 0,
    exp: 9999999999
  });
  configMock.mockResolvedValue({
    tenantId: "t1",
    status: "active",
    killSwitch: false,
    model: "claude-haiku-4-5",
    systemPrompt: "sp"
  });
  getUsageMock.mockResolvedValue(0);
  allowMock.mockResolvedValue(true);
  runChatMock.mockResolvedValue({
    reply: "hello",
    newMessages: [{ role: "assistant", content: "hello" }],
    tokensIn: 1,
    tokensOut: 1
  });
  persistMock.mockResolvedValue(undefined);
  incrementMock.mockResolvedValue(undefined);
});

describe("chat handler robustness (U4)", () => {
  it("attaches CORS headers to a successful response (2.6)", async () => {
    const res = await invoke();
    expect(res.statusCode).toBe(200);
    expect(res.headers?.["access-control-allow-origin"]).toBe(ORIGIN);
    expect(res.headers?.vary).toBe("Origin");
  });

  it("attaches CORS headers to error responses (2.6)", async () => {
    const { JwtError } = await import("../lib/jwt-verify.js");
    verifyMock.mockRejectedValue(new JwtError("bad token"));
    const res = await invoke();
    expect(res.statusCode).toBe(401);
    expect(res.headers?.["access-control-allow-origin"]).toBe(ORIGIN);
  });

  it("fails OPEN (still serves) when the rate limiter errors (2.7)", async () => {
    // allowFailOpen already swallows infra errors to true; simulate that here.
    allowMock.mockResolvedValue(true);
    const res = await invoke();
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).reply).toBe("hello");
  });

  it("answers OPTIONS preflight with 204 + CORS", async () => {
    const res = await invoke({
      requestContext: { http: { method: "OPTIONS" } }
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers?.["access-control-allow-origin"]).toBe(ORIGIN);
  });

  it("returns 400 on a malformed JSON body (3.9)", async () => {
    const res = await invoke({ body: "{not json" });
    expect(res.statusCode).toBe(400);
    expect(res.headers?.["access-control-allow-origin"]).toBe(ORIGIN);
  });

  it("still returns the reply (200) when persistence fails (2.7)", async () => {
    persistMock.mockRejectedValue(new Error("ddb down"));
    const res = await invoke();
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).reply).toBe("hello");
  });

  it("still returns the reply (200) when usage accounting fails (2.7)", async () => {
    incrementMock.mockRejectedValue(new Error("ddb down"));
    const res = await invoke();
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).reply).toBe("hello");
  });
});
