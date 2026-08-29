import { describe, it, expect } from "vitest";
import { contrastOk, splitLinks, isSafeApiBase } from "./util.js";

describe("isSafeApiBase (4.7 — no token redirect)", () => {
  it("accepts https", () => {
    expect(isSafeApiBase("https://api.example.com")).toBe(true);
  });
  it("accepts http on loopback (local dev / E2E)", () => {
    expect(isSafeApiBase("http://localhost:4310")).toBe(true);
    expect(isSafeApiBase("http://127.0.0.1:4310")).toBe(true);
  });
  it("rejects non-loopback http (downgrade / exfil)", () => {
    expect(isSafeApiBase("http://attacker.com")).toBe(false);
    expect(isSafeApiBase("http://evil.example.com")).toBe(false);
  });
  it("rejects junk / empty / non-strings", () => {
    expect(isSafeApiBase("")).toBe(false);
    expect(isSafeApiBase("not a url")).toBe(false);
    expect(isSafeApiBase(undefined)).toBe(false);
    expect(isSafeApiBase(123)).toBe(false);
  });
});

describe("contrastOk (4.17 — brand color readability)", () => {
  it("accepts the platform accent (readable with white text)", () => {
    expect(contrastOk("#6d5ae6")).toBe(true);
  });

  it("accepts dark colors", () => {
    expect(contrastOk("#000000")).toBe(true);
    expect(contrastOk("#14131a")).toBe(true);
  });

  it("rejects pale colors that make white text unreadable", () => {
    expect(contrastOk("#ffff00")).toBe(false); // bright yellow
    expect(contrastOk("#f5f4fa")).toBe(false); // near-white
    expect(contrastOk("#ffffff")).toBe(false); // white on white
  });

  it("rejects malformed input (falls back to accent)", () => {
    expect(contrastOk("not-a-color")).toBe(false);
    expect(contrastOk("#abc")).toBe(false); // shorthand not supported
    expect(contrastOk("")).toBe(false);
  });
});

describe("splitLinks (4.15 — safe clickable links)", () => {
  it("returns a single text segment when there is no URL", () => {
    expect(splitLinks("hello world")).toEqual([
      { type: "text", value: "hello world" }
    ]);
  });

  it("linkifies http and https URLs", () => {
    const segs = splitLinks("see https://a.com/x and http://b.io now");
    expect(segs).toEqual([
      { type: "text", value: "see " },
      { type: "link", value: "https://a.com/x" },
      { type: "text", value: " and " },
      { type: "link", value: "http://b.io" },
      { type: "text", value: " now" }
    ]);
  });

  it("does NOT linkify javascript: or data: schemes", () => {
    const segs = splitLinks("javascript:alert(1) data:text/html,x");
    expect(segs.every((s) => s.type === "text")).toBe(true);
  });

  it("handles a URL at the very start and end", () => {
    expect(splitLinks("https://a.com")).toEqual([
      { type: "link", value: "https://a.com" }
    ]);
  });

  it("does not swallow trailing sentence punctuation into the link", () => {
    expect(splitLinks("see https://a.com/x.")).toEqual([
      { type: "text", value: "see " },
      { type: "link", value: "https://a.com/x" },
      { type: "text", value: "." }
    ]);
    expect(splitLinks("(https://a.com)")).toEqual([
      { type: "text", value: "(" },
      { type: "link", value: "https://a.com" },
      { type: "text", value: ")" }
    ]);
  });
});
