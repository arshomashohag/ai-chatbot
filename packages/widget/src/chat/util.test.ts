import { describe, it, expect } from "vitest";
import {
  contrastOk,
  splitLinks,
  isSafeApiBase,
  parseInline,
  parseMarkdown
} from "./util.js";

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

describe("parseInline (markdown emphasis/code/links)", () => {
  it("parses bold, italic and code", () => {
    expect(parseInline("a **b** c")).toEqual([
      { type: "text", value: "a " },
      { type: "bold", value: "b" },
      { type: "text", value: " c" }
    ]);
    expect(parseInline("*x* and _y_")).toEqual([
      { type: "italic", value: "x" },
      { type: "text", value: " and " },
      { type: "italic", value: "y" }
    ]);
    expect(parseInline("run `npm i`")).toEqual([
      { type: "text", value: "run " },
      { type: "code", value: "npm i" }
    ]);
  });

  it("keeps code content literal (no nested emphasis)", () => {
    expect(parseInline("`a*b*c`")).toEqual([{ type: "code", value: "a*b*c" }]);
  });

  it("leaves a stray asterisk as literal text", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([
      { type: "text", value: "2 * 3 = 6" }
    ]);
  });

  it("still linkifies urls inside inline text", () => {
    expect(parseInline("see https://a.com now")).toEqual([
      { type: "text", value: "see " },
      { type: "link", value: "https://a.com" },
      { type: "text", value: " now" }
    ]);
  });
});

describe("parseMarkdown (blocks)", () => {
  it("splits paragraphs on blank lines", () => {
    const b = parseMarkdown("hello\n\nworld");
    expect(b.map((x) => x.type)).toEqual(["paragraph", "paragraph"]);
  });

  it("parses ATX headings with levels", () => {
    const b = parseMarkdown("# Title\n## Sub");
    expect(b).toEqual([
      { type: "heading", level: 1, inlines: [{ type: "text", value: "Title" }] },
      { type: "heading", level: 2, inlines: [{ type: "text", value: "Sub" }] }
    ]);
  });

  it("groups consecutive bullets into one unordered list", () => {
    const b = parseMarkdown("- one\n- two\n- three");
    expect(b.length).toBe(1);
    expect(b[0]).toMatchObject({ type: "list", ordered: false });
    expect((b[0] as { items: unknown[] }).items.length).toBe(3);
  });

  it("parses ordered lists and separates them from unordered", () => {
    const b = parseMarkdown("1. a\n2. b\n\n- c");
    expect(b.map((x) => x.type)).toEqual(["list", "list"]);
    expect(b[0]).toMatchObject({ ordered: true });
    expect(b[1]).toMatchObject({ ordered: false });
  });

  it("applies inline formatting inside blocks", () => {
    const b = parseMarkdown("Here is **bold** text");
    expect(b[0]).toMatchObject({ type: "paragraph" });
    expect((b[0] as { inlines: unknown[] }).inlines).toContainEqual({
      type: "bold",
      value: "bold"
    });
  });

  it("returns an empty array for empty input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("   \n\n  ")).toEqual([]);
  });
});
