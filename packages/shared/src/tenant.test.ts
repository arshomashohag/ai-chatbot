import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { assertTenantId, isValidTenantId } from "./tenant.js";

describe("assertTenantId (2.1 — tenant-access guard)", () => {
  it("accepts the ids the platform actually mints", () => {
    expect(assertTenantId("t_01hxyzabc123")).toBe("t_01hxyzabc123");
    expect(assertTenantId("tenant_a")).toBe("tenant_a");
    expect(assertTenantId("abc-123.def")).toBe("abc-123.def");
  });

  it("rejects ids that could broaden a key or query", () => {
    for (const bad of [
      "", // empty
      "  ", // whitespace
      "*", // wildcard → could reach an IAM/attribute wildcard
      "TENANT#x", // '#' → partition-prefix escape
      "a#b",
      "a/b", // path
      "a b", // space
      "a\tb", // control
      "a\nb",
      "x".repeat(200) // too long
    ]) {
      expect(() => assertTenantId(bad)).toThrow(/invalid tenant id/);
    }
  });

  it("rejects non-strings", () => {
    expect(() => assertTenantId(undefined)).toThrow();
    expect(() => assertTenantId(null)).toThrow();
    expect(() => assertTenantId(123)).toThrow();
    expect(() => assertTenantId({})).toThrow();
  });

  // PBT-03 (invariant), PBT-07 (domain generator), PBT-08 (fast-check shrink/seed)
  it("property: any string containing #, *, /, or whitespace is rejected", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.constantFrom("#", "*", "/", " ", "\t", "\n"),
        (s, sep) => {
          const withBad = `${s}${sep}x`;
          expect(isValidTenantId(withBad)).toBe(false);
        }
      )
    );
  });

  it("property: a valid id passes through unchanged (idempotent)", () => {
    fc.assert(
      fc.property(
        fc
          .stringMatching(/^[A-Za-z0-9_.-]+$/)
          .filter((s) => s.length > 0 && s.length <= 128),
        (id) => {
          expect(assertTenantId(id)).toBe(id);
        }
      )
    );
  });
});
