import { describe, it, expect } from "vitest";
import { handler } from "./health.js";
import { HealthResponse } from "@platform/shared";

const ctx = {} as never;
const cb = (() => {}) as never;

describe("health handler", () => {
  it("returns 200 with a valid HealthResponse", async () => {
    process.env.ENV = "test";
    const res = await handler({} as never, ctx, cb);
    if (!res || typeof res === "string") throw new Error("bad result");
    expect(res.statusCode).toBe(200);
    const parsed = HealthResponse.parse(JSON.parse(res.body as string));
    expect(parsed.status).toBe("ok");
    expect(parsed.env).toBe("test");
  });
});
