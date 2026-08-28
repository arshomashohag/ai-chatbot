import { describe, it, expect } from "vitest";
import { isOriginAllowed, normalizeOrigin } from "./origin.js";

describe("origin allowlist", () => {
  const allow = ["https://shop.example.com", "http://localhost:5173"];

  it("allows an exact registered origin", () => {
    expect(isOriginAllowed("https://shop.example.com", allow)).toBe(true);
  });

  it("is case-insensitive on host", () => {
    expect(isOriginAllowed("https://SHOP.example.com", allow)).toBe(true);
  });

  it("rejects a foreign origin", () => {
    expect(isOriginAllowed("https://evil.com", allow)).toBe(false);
  });

  it("rejects a subdomain not in the list", () => {
    expect(isOriginAllowed("https://admin.example.com", allow)).toBe(false);
  });

  it("rejects empty / malformed origin", () => {
    expect(isOriginAllowed("", allow)).toBe(false);
    expect(isOriginAllowed("not-a-url", allow)).toBe(false);
  });

  it("normalizes protocol+host, drops path", () => {
    expect(normalizeOrigin("https://a.com/path")).toBe("https://a.com");
  });
});
