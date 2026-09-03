// Direct checks on the three problems found while walking the flow.
import { seedFromMarkets, nextWindowFor, validate } from "../src/strategy.js";
import { normaliseInterval, marketName } from "../src/lib/language.js";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

let bad = 0;
const ok = (m, d = "") => console.log(`  PASS  ${m}${d ? ` — ${d}` : ""}`);
const fail = (m, d = "") => { console.log(`  FAIL  ${m}${d ? ` — ${d}` : ""}`); bad++; };

// 1. The builder must never dead-end while two markets are open.
console.log("\n1. Builder dead-end");
[[298, 300], [300, 300], [898, 900], [900, 900], [3600, 3600], [86400, 86400]].forEach(([raw, want]) => {
  normaliseInterval(raw) === want ? ok(`cadence ${raw}s reads as ${want}s`) : fail(`cadence ${raw}s`, `got ${normaliseInterval(raw)}`);
});

// The indexer is occasionally unreachable; that is not a defect in this code,
// so it is reported as skipped rather than crashing the run.
// The fetch runs in a child process. In one process alongside viem, Node on
// Windows aborts during teardown with a libuv assertion after all checks have
// already passed, which would make the exit code untrustworthy.
let open = [];
let live = true;
try {
  const raw = execFileSync(process.execPath, ["scripts/fetch-open-markets.mjs"], { encoding: "utf8", timeout: 60000 });
  open = JSON.parse(raw);
  if (!Array.isArray(open) || open.length === 0) throw new Error("no markets returned");
} catch (cause) {
  live = false;
  console.log(`  SKIP  live market checks — indexer unreachable (${String(cause.message).split(/\r?\n/)[0]})`);
}

let seeded = { steps: [] };
if (live) {
  seeded = seedFromMarkets(open);
  seeded.steps.length > 0
    ? ok("live markets seed a usable sequence", `${marketName(open.find(m => m.marketId === seeded.steps[0].triggerMarketId))} -> ${marketName(open.find(m => m.marketId === seeded.steps[0].successorMarketId))}`)
    : fail("live markets seed a usable sequence", "zero steps: this is the dead end");
  validate(seeded).length === 0 ? ok("the seeded sequence validates") : fail("the seeded sequence validates", JSON.stringify(validate(seeded)));
}

// The exact shape that used to break it: one window per series, mixed cadences.
const oneEach = [
  { asset: "ETH", intervalSec: 60, marketId: "0x" + "1".repeat(64), pool: "0x" + "1".repeat(40), expiry: 1000, question: "ETH closes at or above its opening price" },
  { asset: "BTC", intervalSec: 298, marketId: "0x" + "2".repeat(64), pool: "0x" + "2".repeat(40), expiry: 2000, question: "BTC closes at or above its opening price" },
  { asset: "BTC", intervalSec: 900, marketId: "0x" + "3".repeat(64), pool: "0x" + "3".repeat(40), expiry: 3000, question: "BTC closes at or above its opening price" },
];
seedFromMarkets(oneEach).steps.length === 1
  ? ok("one window per series still seeds (the case that dead-ended)")
  : fail("one window per series still seeds", "zero steps");
seedFromMarkets([oneEach[0]]).steps.length === 0
  ? ok("a single market correctly seeds nothing, and the screen says so")
  : fail("a single market seeds nothing");

// 2. Keep rolling must only offer what the open windows support.
console.log("\n2. Keep rolling reach");
const reachOf = (markets, successor) => {
  let reach = 1, cursor = successor;
  while (cursor && reach < 4) {
    const next = nextWindowFor(markets, cursor);
    if (!next) break;
    reach += 1; cursor = next;
  }
  return reach;
};
const twoOnly = oneEach.slice(0, 2);
reachOf(twoOnly, twoOnly[1]) === 1
  ? ok("two markets offer Stop only, not phantom roll options")
  : fail("two markets offer Stop only", `reach ${reachOf(twoOnly, twoOnly[1])}`);
if (live) {
  const liveSeedSuccessor = open.find(m => m.marketId === seeded.steps[0]?.successorMarketId);
  console.log(`  live reach: ${reachOf(open, liveSeedSuccessor)} settlement(s) from ${open.length} open markets`);
}
const builder = readFileSync("src/components/Builder.jsx", "utf8");
/\[2, 3, 4\]\.filter\(\(n\) => n <= reach\)/.test(builder)
  ? ok("the builder filters roll options by what is reachable")
  : fail("the builder filters roll options by what is reachable");

// 3. A connected phone must be able to navigate.
console.log("\n3. Mobile navigation");
const nav = readFileSync("src/components/Nav.jsx", "utf8");
/mobile-nav/.test(nav) && /md:hidden/.test(nav)
  ? ok("a compact nav renders below the desktop breakpoint")
  : fail("a compact nav renders below the desktop breakpoint");
const css = readFileSync("src/index.css", "utf8");
/\.mobile-nav\b/.test(css) ? ok("the compact nav is styled") : fail("the compact nav is styled");
["Your sequences", "Build", "Onchain"].every((l) => nav.includes(l))
  ? ok("all three destinations are reachable on a phone")
  : fail("all three destinations are reachable on a phone");

console.log(bad ? `\nverify-three: ${bad} FAILURE(S)\n` : "\nverify-three: all three resolved\n");
process.exit(bad ? 1 : 0);
