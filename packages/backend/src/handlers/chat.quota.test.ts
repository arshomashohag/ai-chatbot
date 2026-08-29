import { describe, it, expect, beforeEach, vi } from "vitest";

// Quota enforcement + auto kill-switch (finding 1.1). Stub the collaborators so
// we can drive usage vs limit deterministically and assert the model is never
// called over quota and the kill-switch trips.

const verifyMock = vi.fn();
const configMock = vi.fn();
const evictMock = vi.fn();
const getUsageMock = vi.fn();
const tripMock = vi.fn();
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
  evictTenantConfig: (...a: unknown[]) => evictMock(...a)
}));
vi.mock("../lib/ddb.js", () => ({
  getUsage: (...a: unknown[]) => getUsageMock(...a),
  tripKillSwitch: (...a: unknown[]) => tripMock(...a),
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
vi.mock("../lib/adapter/anthropic.js", () => ({
  AnthropicAdapter: class {}
}));

const { handler } = await import("./chat.js");
const ctx = {} as never;
const cb = (() => {}) as never;

function invoke() {
  return handler(
    {
      headers: { authorization: "Bearer x", origin: "https://shop.example.com" },
      body: JSON.stringify({ message: "hi" })
    } as never,
    ctx,
    cb
  ) as Promise<{ statusCode: number; body: string }>;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_KMS_KEY_ID = "key-1";
  // Request Origin (shop.example.com) is the chat surface for this test so the
  // origin gate passes — these tests exercise quota, not origin binding.
  process.env.CHAT_ORIGIN = "shop.example.com";
  verifyMock.mockResolvedValue({
    tenant_id: "t1",
    session_id: "s1",
    origin: "https://shop.example.com",
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
    systemPrompt: "sp",
    monthlyMessageLimit: 100
  });
  allowMock.mockResolvedValue(true);
  runChatMock.mockResolvedValue({
    reply: "hello",
    newMessages: [{ role: "assistant", content: "hello" }],
    tokensIn: 1,
    tokensOut: 1
  });
  persistMock.mockResolvedValue(undefined);
  incrementMock.mockResolvedValue(undefined);
  tripMock.mockResolvedValue(undefined);
});

describe("chat quota enforcement (1.1)", () => {
  it("under limit → model is called, normal reply", async () => {
    getUsageMock.mockResolvedValue(99);
    const res = await invoke();
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).reply).toBe("hello");
    expect(runChatMock).toHaveBeenCalledOnce();
    expect(tripMock).not.toHaveBeenCalled();
  });

  it("at limit → over-quota reply, model NOT called, kill-switch tripped + cache evicted", async () => {
    getUsageMock.mockResolvedValue(100);
    const res = await invoke();
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).reply).toMatch(/message limit/i);
    expect(runChatMock).not.toHaveBeenCalled();
    expect(tripMock).toHaveBeenCalledWith("t1");
    expect(evictMock).toHaveBeenCalledWith("t1");
  });

  it("over limit → same hard-stop", async () => {
    getUsageMock.mockResolvedValue(500);
    const res = await invoke();
    expect(JSON.parse(res.body).reply).toMatch(/message limit/i);
    expect(runChatMock).not.toHaveBeenCalled();
  });

  it("uses the platform default when no tenant limit is set", async () => {
    configMock.mockResolvedValue({
      tenantId: "t1",
      status: "active",
      killSwitch: false,
      model: "claude-haiku-4-5",
      systemPrompt: "sp"
      // no monthlyMessageLimit
    });
    getUsageMock.mockResolvedValue(9_999); // just under 10_000 default
    const res = await invoke();
    expect(runChatMock).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it("a 0 configured limit falls back to the default (fail-safe, not unlimited)", async () => {
    configMock.mockResolvedValue({
      tenantId: "t1",
      status: "active",
      killSwitch: false,
      model: "claude-haiku-4-5",
      systemPrompt: "sp",
      monthlyMessageLimit: 0
    });
    getUsageMock.mockResolvedValue(9_999);
    const res = await invoke();
    expect(runChatMock).toHaveBeenCalledOnce(); // under the 10k default, not "unlimited"
    expect(res.statusCode).toBe(200);
  });

  it("usage-read failure fails CLOSED (friendly degrade), does not bypass into the model", async () => {
    getUsageMock.mockRejectedValue(new Error("ddb blip"));
    const res = await invoke();
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).reply).toMatch(/trouble/i);
    expect(runChatMock).not.toHaveBeenCalled();
  });
});
