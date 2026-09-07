// Every name a module calls, it must import or define.
//
// This has now bitten twice in one session. `assertVaultStep` was called in
// chain/vault.js with no import and reached a user as "assertVaultStep is not
// defined" at the exact moment they tried to activate. Minutes later
// `isCoreAsset` went the same way in the builder. Both times the edit that added
// the import failed silently because its anchor did not match, and both times
// every suite still passed: the unit tests import the helper module directly, so
// they never execute the caller, and the browser suite cannot sign, so it stops
// before the line runs.
//
// Vite will not catch it either — an undefined identifier is legal JavaScript
// until control reaches it. So this reads the source and checks that every
// helper a module calls is one it actually has.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(js|jsx)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

// Comments and string literals are prose, not code. The first version of this
// check scanned them too and reported things like "at or above (" as a missing
// function, which made it useless.
function stripNonCode(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === "//") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    if (two === "/*") {
      i += 2;
      while (i < src.length && src.slice(i, i + 2) !== "*/") i += 1;
      i += 2;
      continue;
    }
    const ch = src[i];
    // A regex literal is code, but its body is a pattern, not calls. Left in, it
    // reports /roll(ing)?/ as a missing broll() function.
    if (ch === "/" && /[(=,:&|!?[{;\n]\s*$/.test(out)) {
      i += 1;
      let closed = false;
      while (i < src.length) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "\n") break;
        if (src[i] === "/") { closed = true; i += 1; break; }
        i += 1;
      }
      if (closed) { while (i < src.length && /[gimsuyd]/.test(src[i])) i += 1; out += "RE"; continue; }
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      out += '""';
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

// Names this file brings in or declares for itself.
function declared(src) {
  const names = new Set();
  const add = (list) => String(list).split(",").forEach((part) => {
    const name = part.split(" as ").pop().replace(/[{}[\]().]/g, "").trim();
    if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
  });

  for (const m of src.matchAll(/import\s*{([^}]*)}\s*from/g)) add(m[1]);
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // Destructuring, including the [value, setValue] pair useState returns.
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s*\[([^\]]*)\]\s*=/g)) add(m[1]);
  // Parameters and arrow bindings.
  for (const m of src.matchAll(/function\s*[\w$]*\s*\(([^)]*)\)/g)) add(m[1]);
  for (const m of src.matchAll(/\(([^)]*)\)\s*=>/g)) add(m[1]);
  // async ({ a, b }) => ... destructures too.
  for (const m of src.matchAll(/async\s*\(\s*\{([^}]*)\}\s*\)/g)) add(m[1]);
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1]);
  for (const m of src.matchAll(/catch\s*\(\s*([\w$]*)\s*\)/g)) names.add(m[1]);
  return names;
}

const GLOBALS = new Set([
  "console", "window", "document", "Math", "Number", "String", "Boolean", "Object", "Array",
  "JSON", "Date", "Promise", "Set", "Map", "WeakMap", "BigInt", "Error", "TypeError", "RangeError",
  "parseInt", "parseFloat", "isNaN", "isFinite", "fetch", "setTimeout", "clearTimeout",
  "setInterval", "clearInterval", "encodeURIComponent", "decodeURIComponent", "Intl", "URL",
  "Symbol", "require", "structuredClone", "queueMicrotask", "AbortController", "Uint8Array",
  "TextEncoder", "TextDecoder", "localStorage", "sessionStorage", "alert", "crypto",
]);

const KEYWORDS = /^(if|for|while|switch|catch|return|typeof|await|new|function|of|in|do|else|delete|void|throw|yield|super|this|import|export|async)$/;

const problems = [];
for (const file of walk(root)) {
  const src = stripNonCode(readFileSync(file, "utf8"));
  const known = declared(src);
  const seen = new Set();
  for (const m of src.matchAll(/(^|[^.\w$])([a-z][A-Za-z0-9_$]{2,})\s*\(/g)) {
    const name = m[2];
    if (seen.has(name) || known.has(name) || GLOBALS.has(name) || KEYWORDS.test(name)) continue;
    seen.add(name);
    problems.push(`${relative(root, file)}: calls ${name}() but never imports or defines it`);
  }
}

if (problems.length) {
  console.log("unresolved references:\n");
  for (const p of problems) console.log(`  ${p}`);
  console.log(`\nverify-references: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`verify-references: ${walk(root).length} modules, every called helper is imported or defined`);
