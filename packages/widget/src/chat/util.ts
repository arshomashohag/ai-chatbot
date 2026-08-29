// Pure helpers for the chat widget — no DOM access, so they are unit-testable
// in a node environment (main.ts runs DOM bootstrap on import and cannot be).

// Relative luminance per WCAG.
function luminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const chan = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * chan[0]! + 0.7152 * chan[1]! + 0.0722 * chan[2]!;
}

/** True if `hex` has ≥ ~2.5:1 contrast against white (readable with white text). */
export function contrastOk(hex: string): boolean {
  const l = luminance(hex);
  if (l === null) return false;
  const ratio = 1.05 / (l + 0.05); // white luminance = 1.0
  return ratio >= 2.5;
}

/**
 * A safe API base is https, OR http on a loopback host (localhost/127.0.0.1)
 * for local dev/E2E. Non-loopback http is rejected so a framed chat page can't
 * redirect the bearer token to a downgraded/attacker endpoint (finding 4.7).
 */
export function isSafeApiBase(value: unknown): boolean {
  if (typeof value !== "string" || value === "") return false;
  try {
    const u = new URL(value);
    if (u.protocol === "https:") return true;
    if (
      u.protocol === "http:" &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export type Segment = { type: "text" | "link"; value: string };

/**
 * Split text into plain and link segments. Only http(s) URLs become links, so
 * javascript:/data:/other schemes are never linkified (rendered as plain text).
 */
export function splitLinks(text: string): Segment[] {
  const urlRe = /(https?:\/\/[^\s]+)/g;
  const out: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(urlRe)) {
    let url = match[0];
    const idx = match.index ?? 0;
    // Don't swallow trailing sentence punctuation into the link.
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
