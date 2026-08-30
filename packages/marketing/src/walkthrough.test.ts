import { describe, it, expect } from "vitest";
import { drawPercent, stationReached } from "./walkthrough.js";

const VH = 800;

describe("drawPercent", () => {
  it("is 0 before the track has entered the trigger zone", () => {
    // track top well below the 85%-viewport trigger line
    expect(drawPercent(VH, 600, VH)).toBe(0);
  });

  it("reaches 100 once the track has fully passed through", () => {
    // track scrolled far up (large negative top) → fully drawn
    expect(drawPercent(-2000, 600, VH)).toBe(100);
  });

  it("is monotonic non-decreasing as the track scrolls upward", () => {
    let prev = -1;
    for (let top = VH; top >= -1600; top -= 40) {
      const pct = drawPercent(top, 600, VH);
      expect(pct).toBeGreaterThanOrEqual(prev);
      prev = pct;
    }
  });

  it("stays within [0, 100] for arbitrary inputs", () => {
    for (const top of [5000, 0, -5000, -99999]) {
      const pct = drawPercent(top, 600, VH);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
  });

  it("returns 0 defensively when the track has no measurable height", () => {
    // guards against a divide-by-zero when the section isn't laid out yet
    expect(drawPercent(-1000, 0, 0)).toBe(0);
  });
});

describe("stationReached", () => {
  it("is false while the node sits in the lower viewport", () => {
    expect(stationReached(VH * 0.9, VH)).toBe(false);
  });

  it("is true once the node rises above 70% of the viewport", () => {
    expect(stationReached(VH * 0.5, VH)).toBe(true);
  });
});
