// Lightweight, SAFE Markdown → AST. Model replies come back in Markdown; raw
// `**`, `#`, `-`, `` ` `` should render as formatting, not literal characters.
// This parses the common subset into a structured tree that each surface (the
// widget chat app, the portal transcript) turns into DOM/React nodes
// PROGRAMMATICALLY — never via innerHTML/dangerouslySetInnerHTML of model text —
// so formatting renders while XSS stays impossible. Pure + unit-tested.

export type Inline =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; value: string };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; inlines: Inline[] }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] };

export type Segment = { type: "text" | "link"; value: string };

/**
 * Split text into plain and link segments. Only http(s) URLs become links, so
 * javascript:/data:/other schemes are never linkified (rendered as plain text).
 * Trailing sentence punctuation is kept out of the link.
 */
export function splitLinks(text: string): Segment[] {
  const urlRe = /(https?:\/\/[^\s]+)/g;
  const out: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(urlRe)) {
    let url = match[0];
    const idx = match.index ?? 0;
    const trailing = /[.,!?;:)\]]+$/.exec(url);
    let tail = "";
    if (trailing) {
      tail = trailing[0];
      url = url.slice(0, url.length - tail.length);
    }
    if (idx > last) out.push({ type: "text", value: text.slice(last, idx) });
    out.push({ type: "link", value: url });
    last = idx + url.length;
    if (tail) {
      out.push({ type: "text", value: tail });
      last += tail.length;
    }
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

// Expand a plain-text run into text + link inlines, reusing splitLinks so URL
// handling stays in one place.
function pushText(out: Inline[], value: string): void {
  if (!value) return;
  for (const seg of splitLinks(value)) {
    out.push(
      seg.type === "link"
        ? { type: "link", value: seg.value }
        : { type: "text", value: seg.value }
    );
  }
}

/**
 * Parse inline Markdown within a single line into segments: `**bold**`,
 * `*italic*` / `_italic_`, `` `code` ``, and http(s) links. Anything unmatched
 * stays literal text; emphasis markers are consumed only as matched pairs, so a
 * stray `*` renders as itself.
 */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  // Order matters: code first (its content is literal), then bold, then italic.
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\n]+)\*|_([^_\n]+)_/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) pushText(out, text.slice(last, idx));
    if (m[1] !== undefined) out.push({ type: "code", value: m[1] });
    else if (m[2] !== undefined) out.push({ type: "bold", value: m[2] });
    else if (m[3] !== undefined) out.push({ type: "italic", value: m[3] });
    else if (m[4] !== undefined) out.push({ type: "italic", value: m[4] });
    last = idx + m[0].length;
  }
  if (last < text.length) pushText(out, text.slice(last));
  return out;
}

/**
 * Parse a Markdown message into blocks: ATX headings (`#`–`###`), unordered
 * (`-`, `*`, `+`) and ordered (`1.`) lists, and paragraphs. Blank lines
 * separate paragraphs; consecutive list items group into one list. Unsupported
 * block syntax degrades to a paragraph, so nothing is ever lost.
 */
export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;

  const flushPara = (): void => {
    if (para.length) {
      blocks.push({ type: "paragraph", inlines: parseInline(para.join(" ")) });
      para = [];
    }
  };
  const flushList = (): void => {
    if (list) {
      blocks.push({ type: "list", ordered: list.ordered, items: list.items });
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flushPara();
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({
        type: "heading",
        level: heading[1]!.length as 1 | 2 | 3,
        inlines: parseInline(heading[2]!.trim())
      });
      continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const ordered = Boolean(ol);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(parseInline((ul ? ul[1]! : ol![1]!).trim()));
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}
