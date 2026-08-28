import { describe, it, expect } from "vitest";
import { assembleSystemPrompt } from "./prompt-assembly.js";
import type { KbEntry } from "@platform/shared";

function entry(id: string, body: string, enabled = true): KbEntry {
  return { id, type: "faq", title: `Q${id}`, body, enabled };
}

describe("assembleSystemPrompt", () => {
  it("puts the static base first, then profile, then entries", () => {
    const { prompt } = assembleSystemPrompt("BASE", {
      businessProfile: "We sell hats.",
      entries: [entry("1", "Returns within 30 days.")]
    });
    expect(prompt.startsWith("BASE")).toBe(true);
    expect(prompt.indexOf("We sell hats")).toBeLessThan(
      prompt.indexOf("Returns within 30 days")
    );
  });

  it("excludes disabled entries", () => {
    const { prompt } = assembleSystemPrompt("BASE", {
      entries: [entry("1", "SECRET", false), entry("2", "SHOWN", true)]
    });
    expect(prompt).not.toContain("SECRET");
    expect(prompt).toContain("SHOWN");
  });

  it("caps under the size limit and reports capped=true (oldest-first)", () => {
    const big = "x".repeat(5000);
    const { capped, prompt } = assembleSystemPrompt("BASE", {
      entries: [entry("1", big), entry("2", big), entry("3", big)]
    });
    expect(capped).toBe(true);
    expect(prompt.length).toBeLessThan(12_000 + 200);
  });
});
