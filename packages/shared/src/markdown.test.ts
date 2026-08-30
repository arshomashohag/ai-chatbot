import { describe, it, expect } from "vitest";
import { splitLinks, parseInline, parseMarkdown } from "./markdown.js";

describe("splitLinks", () => {
  it("linkifies only http(s) urls", () => {
    expect(splitLinks("go to https://a.com now")).toEqual([
      { type: "text", value: "go to " },
      { type: "link", value: "https://a.com" },
      { type: "text", value: " now" }
    ]);
  });

  it("never linkifies javascript: or data: schemes", () => {
    expect(splitLinks("javascript:alert(1)")).toEqual([
      { type: "text", value: "javascript:alert(1)" }
    ]);
  });

  it("keeps trailing punctuation out of the link", () => {
    expect(splitLinks("see https://a.com/x.")).toEqual([
      { type: "text", value: "see " },
      { type: "link", value: "https://a.com/x" },
      { type: "text", value: "." }
    ]);
  });
});

describe("parseInline", () => {
  it("parses bold, italic (both markers) and code", () => {
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

  it("keeps code content literal", () => {
    expect(parseInline("`a*b*c`")).toEqual([{ type: "code", value: "a*b*c" }]);
  });

  it("leaves a stray asterisk as literal text", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([
      { type: "text", value: "2 * 3 = 6" }
    ]);
  });

  it("linkifies urls inside inline text", () => {
    expect(parseInline("see https://a.com now")).toContainEqual({
      type: "link",
      value: "https://a.com"
    });
  });
});

describe("parseMarkdown", () => {
  it("splits paragraphs on blank lines", () => {
    expect(parseMarkdown("hello\n\nworld").map((b) => b.type)).toEqual([
      "paragraph",
      "paragraph"
    ]);
  });

  it("parses ATX headings with levels", () => {
    expect(parseMarkdown("# Title\n## Sub")).toEqual([
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

  it("separates ordered from unordered lists", () => {
    const b = parseMarkdown("1. a\n2. b\n\n- c");
    expect(b.map((x) => x.type)).toEqual(["list", "list"]);
    expect(b[0]).toMatchObject({ ordered: true });
    expect(b[1]).toMatchObject({ ordered: false });
  });

  it("applies inline formatting inside blocks", () => {
    const b = parseMarkdown("Here is **bold** text");
    expect((b[0] as { inlines: unknown[] }).inlines).toContainEqual({
      type: "bold",
      value: "bold"
    });
  });

  it("returns an empty array for blank input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("   \n\n  ")).toEqual([]);
  });
});
