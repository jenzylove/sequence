// Screenshot the trading builder for a wallet with funds and no account.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const addr = readFileSync(join(repo, "docs", "SHOWCASE_KEY.txt"), "utf8").trim().split("\n")[0];
const base = process.env.BASE_URL || "http://localhost:4173";

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1150 } })).newPage();
await page.addInitScript((a) => {
  const provider = {
    request: async ({ method }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [a];
      if (method === "eth_chainId") return "0xc488";
      throw Object.assign(new Error("no signing here"), { code: 4200 });
    },
    on() {}, removeListener() {},
  };
  window.addEventListener("eip6963:requestProvider", () => {
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
      detail: { info: { uuid: "w", name: "Rabby Wallet", icon: "" }, provider },
    }));
  });
}, addr);

await page.goto(base, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: /Build your sequence/ }).first().click();
await page.getByRole("button", { name: /Rabby Wallet/ }).click();
await page.waitForSelector("#build", { timeout: 60000 });
// Wait for the builder to actually hold a sequence rather than a fixed delay:
// the indexer can take a while, and market windows roll over constantly.
await page.getByRole("button", { name: /Activate sequence/ }).waitFor({ timeout: 120000 }).catch(() => {});
await page.waitForTimeout(6000);

const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
const checks = [
  ["market panel names what is watched", /watching/i.test(t)],
  ["settlement countdown", /settles/i.test(t)],
  ["YES and NO implied probability", /%/.test(t)],
  ["traded price history section", /Yes price, traded/i.test(t)],
  ["book context (best ask + depth)", /Best ask/i.test(t) && /Depth/i.test(t)],
  ["successor market shown", /Then trades/i.test(t)],
  ["per-trade amount is not zero", !/\$0\.00(?!\d)[^]{0,30}per trade/i.test(t)],
];
for (const [label, pass] of checks) console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}`);

await page.screenshot({ path: join(repo, "docs", "journey-v2", "09-builder-market.png"), fullPage: true });
console.log("\nsaved docs/journey-v2/09-builder-market.png");
await browser.close();
process.exit(checks.every(([, p]) => p) ? 0 : 1);
