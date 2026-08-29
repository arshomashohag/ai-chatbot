import { randomBytes } from "node:crypto";

// Self-contained ULID generator. We do NOT use the `ulid` npm package: its
// module eagerly runs `ulid = factory()` at import time, and its PRNG detection
// uses `require("crypto")` which does not exist in our ESM-bundled Lambdas — so
// merely importing it throws "secure crypto unusable, insecure Math.random not
// allowed" at load (surfaced first on the post-confirmation Cognito trigger).
// A ULID is a 48-bit millisecond timestamp + 80 bits of randomness, encoded in
// Crockford base32 (26 chars). Randomness comes from node:crypto (imported via
// ESM `import`, which esbuild bundles correctly).

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(now: number): string {
  let out = "";
  let t = now;
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    out = ENCODING[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

function encodeRandom(): string {
  // 16 base32 chars = 80 bits. One secure random byte per char, masked to 5 bits.
  const bytes = randomBytes(RANDOM_LEN);
  let out = "";
  for (let i = 0; i < RANDOM_LEN; i++) {
    out += ENCODING[bytes[i]! & 0x1f];
  }
  return out;
}

/** Generate a ULID (26-char, lexicographically sortable, crypto-random). */
export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

/**
 * A monotonic ULID factory: within the same millisecond, successive calls are
 * strictly increasing (the random component is incremented) so message sort
 * keys never collide or reorder for same-ms writes.
 */
export function monotonicUlid(): () => string {
  let lastTime = 0;
  let lastRandom = "";
  return function next(): string {
    const now = Date.now();
    if (now <= lastTime) {
      lastRandom = incrementBase32(lastRandom);
      return encodeTime(lastTime) + lastRandom;
    }
    lastTime = now;
    lastRandom = encodeRandom();
    return encodeTime(now) + lastRandom;
  };
}

// Increment a Crockford-base32 string by 1 (right-to-left carry). Used to keep
// same-millisecond ULIDs strictly increasing.
function incrementBase32(str: string): string {
  const chars = str.split("");
  for (let i = chars.length - 1; i >= 0; i--) {
    const idx = ENCODING.indexOf(chars[i]!);
    if (idx < 31) {
      chars[i] = ENCODING[idx + 1]!;
      return chars.join("");
    }
    chars[i] = ENCODING[0]!; // carry
  }
  // Overflow (all 'Z') — extremely unlikely within one ms; reseed with fresh
  // randomness rather than throw.
  return encodeRandom();
}
