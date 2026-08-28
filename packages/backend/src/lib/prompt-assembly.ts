import type { KbEntry } from "@platform/shared";

const MAX_KB_CHARS = 12_000;

export interface KbContext {
  businessProfile?: string;
  entries: KbEntry[];
}

/**
 * Assemble the system prompt: static base first (for provider prompt-caching),
 * then business profile, then enabled FAQ/context entries. Oldest-first
 * eviction once the cumulative size cap is reached; returns whether capping
 * occurred so the dashboard can warn.
 */
export function assembleSystemPrompt(
  base: string,
  kb: KbContext
): { prompt: string; capped: boolean } {
  const parts: string[] = [base];
  if (kb.businessProfile?.trim()) {
    parts.push(`\n\nBusiness profile:\n${kb.businessProfile.trim()}`);
  }

  let capped = false;
  let used = parts.join("").length;
  const enabled = kb.entries.filter((e) => e.enabled);
  for (const e of enabled) {
    const block = `\n\n[${e.type.toUpperCase()}] ${e.title}\n${e.body}`;
    if (used + block.length > MAX_KB_CHARS) {
      capped = true;
      break;
    }
    parts.push(block);
    used += block.length;
  }

  return { prompt: parts.join(""), capped };
}
