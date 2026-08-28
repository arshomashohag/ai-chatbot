import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIMIT_KB = 30;
const file = resolve(root, "packages/widget/dist/widget.js");

let raw;
try {
  raw = readFileSync(file);
} catch {
  console.error(`widget bundle not found at ${file}. Run the widget build first.`);
  process.exit(1);
}

const rawKb = statSync(file).size / 1024;
const gzKb = gzipSync(raw).length / 1024;

console.log(`widget.js raw=${rawKb.toFixed(2)}KB gz=${gzKb.toFixed(2)}KB (limit ${LIMIT_KB}KB gz)`);

if (gzKb > LIMIT_KB) {
  console.error(`FAIL: gzipped size ${gzKb.toFixed(2)}KB exceeds ${LIMIT_KB}KB`);
  process.exit(1);
}
console.log("OK: within size budget");
