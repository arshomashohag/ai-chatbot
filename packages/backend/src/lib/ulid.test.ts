import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { ulid, monotonicUlid } from "./ulid.js";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/; // Crockford base32, 26 chars

describe("ulid (crypto-backed, dependency-free — fixes the ESM Lambda crash)", () => {
  it("produces a valid 26-char Crockford-base32 ULID", () => {
    const id = ulid();
    expect(id).toMatch(ULID_RE);
    expect(id.length).toBe(26);
  });

  it("is time-ordered: an earlier timestamp sorts before a later one", () => {
    const a = ulid(1_000_000);
    const b = ulid(2_000_000);
    expect(a < b).toBe(true);
  });

  it("property: every generated id is unique and well-formed", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), (n) => {
        const ids = new Set(Array.from({ length: n }, () => ulid()));
        expect(ids.size).toBe(n); // no collisions
        for (const id of ids) expect(id).toMatch(ULID_RE);
      }),
      { numRuns: 10 }
    );
  });

  it("monotonic factory is strictly increasing within the same millisecond", () => {
    const next = monotonicUlid();
    const seq = Array.from({ length: 50 }, () => next());
    for (let i = 1; i < seq.length; i++) {
      expect(seq[i]! > seq[i - 1]!).toBe(true);
    }
    expect(seq.every((s) => ULID_RE.test(s))).toBe(true);
  });
});
