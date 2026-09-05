// A sequence you armed must still be there on a machine that has never seen you.
//
// Sequences used to live in localStorage: clear the browser, or open Sequence on
// a phone, and something that was still running on chain simply disappeared from
// the interface. The vault knows what it is armed on, so this opens a brand-new
// browser profile with empty storage and checks the sequence comes back.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const base = process.env.BASE_URL || "http://localhost:4173";

// Wallets that own vaults with real armed/placed steps on chain.
const wallets = [];
const trading = readFileSync(join(repo, "docs", "TRADING_FIRST_KEY.txt"), "utf8").trim().split("\n")[0];
wallets.push({ label: "trading-first trader", address: trading });
for (const line of readFileSync(join(repo, "docs", "SPIKE_KEYS.txt"), "utf8").trim().split("\n")) {
  if (/^[AB] /.test(line)) {
    const [label, address, , vault] = line.split(" ");
    wallets.push({ label: `shared-Reactivity user ${label}`, address, vault });
  }
}

const browser = await chromium.launch();
const results = [];

for (const w of wallets) {
  // A genuinely fresh profile: no localStorage, no cookies, nothing carried over.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const page = await ctx.newPage();
  await page.addInitScript((a) => {
    try { window.localStorage.clear(); } catch { /* nothing to clear */ }
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
  }, w.address);

  await page.goto(base, { waitUntil: "domcontentloaded" });
  const stored = await page.evaluate(() => Object.keys(window.localStorage).length);

  await page.getByRole("button", { name: /Build your sequence/ }).first().click();
  await page.getByRole("button", { name: /Rabby Wallet/ }).click();
  await page.waitForTimeout(6000);
  const home = page.getByRole("button", { name: "Your sequences", exact: true }).last();
  if (await home.count()) await home.click();
  await page.waitForSelector("#dashboard", { timeout: 60000 });
  await page.waitForTimeout(12000);

  // Look in every tab: an armed step is Live, a fired one is Finished.
  let found = false;
  let where = null;
  for (const tab of ["Live", "Finished"]) {
    const b = page.getByRole("button", { name: new RegExp(`^${tab}`) }).first();
    if (await b.count()) { await b.click(); await page.waitForTimeout(1500); }
    const t = (await page.locator("#dashboard").innerText()).replace(/\s+/g, " ");
    if (!/Nothing is live|Nothing has finished/i.test(t) && /(waiting on|BTC|ETH)/i.test(t)) { found = true; where = tab; break; }
  }

  const shot = `recovery-${w.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
  await page.screenshot({ path: join(repo, "docs", "journey-v2", shot), fullPage: true });
  results.push({ wallet: w.label, address: w.address, storageKeysAtStart: stored, recovered: found, tab: where, shot });
  console.log(`  ${found ? "PASS" : "FAIL"}  ${w.label} — storage started with ${stored} keys; sequence ${found ? `recovered under ${where}` : "did not come back"}`);
  await ctx.close();
}

writeFileSync(join(repo, "docs", "RECOVERY.json"), JSON.stringify({
  question: "Does a sequence survive a cleared browser, or another device?",
  method: "A brand-new browser profile with empty localStorage connects the wallet and reads the vault's own state from chain.",
  results, checkedAt: new Date().toISOString(),
}, null, 2) + "\n");

const failed = results.filter((r) => !r.recovered);
console.log(`\nrecovery: ${results.length - failed.length}/${results.length} wallets recovered from chain`);
await browser.close();
process.exit(failed.length ? 1 : 0);
