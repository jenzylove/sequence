// Repairs literal control bytes that shell-driven edits can write into source
// where a regex escape was intended: a raw 0x08 looks exactly like \b in an
// editor but matches a backspace character, silently disabling the pattern.
//
// verify-arm.mjs fails the build when any are present; this fixes them.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Only the escapes that are plausibly intended in source, mapped back.
const MAP = { "\b": "\\b", "\f": "\\f", "\v": "\\v", "\0": "\\0" };

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/^(node_modules|dist)$/.test(entry.name)) walk(full);
    } else if (/\.(js|jsx|mjs)$/.test(entry.name)) files.push(full);
  }
};
walk(join(root, "src"));
walk(join(root, "scripts"));

let total = 0;
for (const file of files) {
  const before = readFileSync(file, "utf8");
  let after = before;
  for (const [raw, escaped] of Object.entries(MAP)) after = after.split(raw).join(escaped);
  if (after === before) continue;
  const count = [...before].filter((c) => MAP[c]).length;
  writeFileSync(file, after);
  console.log(`${relative(root, file)}: repaired ${count}`);
  total += count;
}
console.log(total === 0 ? "nothing to repair" : `repaired ${total} control bytes`);
