// Pure logic for the scroll-driven setup walkthrough. Kept DOM-free so it can be
// unit-tested in a node environment; main.ts wires these to the actual elements.

/**
 * Map the walkthrough track's position within the viewport to a 0–100 draw
 * percentage. The line begins drawing as the track's top rises past ~85% of the
 * viewport height and completes over the track's height plus a half-viewport of
 * follow-through, so it finishes a little before the section scrolls fully past.
 * Clamped to [0, 100] and rounded to an integer for stable CSS updates.
 */
export function drawPercent(
  trackTop: number,
  trackHeight: number,
  viewportHeight: number
): number {
  const total = trackHeight + viewportHeight * 0.5;
  if (total <= 0) return 0;
  const seen = Math.min(Math.max(viewportHeight * 0.85 - trackTop, 0), total);
  return Math.round((seen / total) * 100);
}

/**
 * Whether a station node (given its top offset in the viewport) has been reached
 * by the drawing line — true once it rises above 70% of the viewport height.
 */
export function stationReached(nodeTop: number, viewportHeight: number): boolean {
  return nodeTop < viewportHeight * 0.7;
}
