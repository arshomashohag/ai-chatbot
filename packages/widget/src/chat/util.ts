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

// Safe Markdown parsing + link splitting now live in @platform/shared so the
// widget and the portal transcript share one tested implementation. Re-exported
// here so existing widget imports (main.ts, util.test.ts) keep working.
export {
  splitLinks,
  parseInline,
  parseMarkdown,
  type Segment,
  type Inline,
  type Block
} from "@platform/shared";
