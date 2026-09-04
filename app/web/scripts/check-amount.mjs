// Types real amounts into "Amount per trade" and reads back every number the
// screen then shows, so the answer to "what does it actually display" comes from
// the running app rather than from reasoning about the code.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "../dist");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  const url = req.url.split("?")[0];
  let file = join(dist, url === "/" ? "index.html" : url);
  if (!existsSync(file)) file = join(dist, "index.html");
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(4183, r));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript((a) => {
  const p = {
    request: async ({ method }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [a];
      if (method === "eth_chainId") return "0xc488";
      throw Object.assign(new Error("no signing"), { code: 4200 });
    },
    on() {}, removeListener() {},
  };
  window.addEventListener("eip6963:requestProvider", () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
    detail: { info: { uuid: "t", name: "Test harness wallet", icon: "", rdns: "t" }, provider: p },
  })));
}, "0x8827d3AF20eFe02582aEA67a5E704C04BAd52324");

const page = await context.newPage();
await page.goto("http://localhost:4183", { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "Build your sequence" }).first().click();
await page.getByRole("button", { name: /Test harness wallet/ }).click();
await page.waitForSelector("#build", { timeout: 45000 });
await page.getByLabel("Amount per trade").waitFor({ timeout: 45000 });

let bad = 0;
for (const typed of ["2", "1", "0.5", "3.75", "0.0001"]) {
  const field = page.getByLabel("Amount per trade");
  await field.fill(typed);
  await field.blur();
  await page.waitForTimeout(700);

  const shown = await field.inputValue();
  // The row contains a <select> whose option list includes an em dash, so the
  // amount is read from its own element rather than by scanning the row text.
  const branches = await page.locator(".branch-row > span:last-child").allInnerTexts();
  const summary = await page.locator("aside").last().innerText();
  const onEach = summary.match(/On each trade\s*\$?([\d.,]+)/)?.[1] ?? "?";
  const raw = await page.evaluate(() => {
    const el = [...document.querySelectorAll("dd")].find((d) => /^\d+$/.test(d.textContent.trim()));
    return el ? el.textContent.trim() : null;
  });

  const amounts = branches.map((b) => b.trim());
  const consistent = amounts.every((a) => a === "—" || a === `$${Number(shown).toLocaleString()}`);
  const withinBudget = Number(shown) <= Number(typed) + 1e-9;

  console.log(`typed $${typed.padEnd(7)} -> field shows $${shown.padEnd(7)} | branches ${amounts.join(" / ").padEnd(16)} | summary $${onEach}`);
  if (!withinBudget) { console.log(`   FAIL: shows more than was typed`); bad++; }
  if (!consistent) { console.log(`   FAIL: field and branches disagree`); bad++; }
}

// An unplaceable amount must block activation rather than quietly trade the old size.
{
  const blocked = await page.locator("#build").innerText();
  const says = /less than the smallest order/i.test(blocked);
  const activateDisabled = await page.getByRole("button", { name: /Activate sequence/ }).isDisabled().catch(() => true);
  console.log(`
unplaceable amount -> explained: ${says} | activation blocked: ${activateDisabled}`);
  if (!says || !activateDisabled) { console.log("   FAIL: an unplaceable amount must be explained and must block activation"); bad++; }
}

// Back to a workable amount, then the quantity actually sent must be a real lot.
await page.getByLabel("Amount per trade").fill("2");
await page.getByLabel("Amount per trade").blur();
await page.waitForTimeout(700);

// And the quantity actually sent must be a real lot, not a handful of units.
await page.locator("#build").getByRole("button", { name: /Onchain details/ }).click();
await page.waitForTimeout(500);
const details = await page.locator("#build").innerText();
const qty = details.match(/Quantity\s*([\d]+)/)?.[1];
console.log(`\nquantity sent to the pool: ${qty}`);
if (!qty || Number(qty) < 1000) { console.log("   FAIL: below the pool's minimum quantity of 1000"); bad++; }

await page.screenshot({ path: resolve(here, "../../../qa/amount-check.png"), fullPage: true });
await browser.close();
server.close();
console.log(bad ? `\ncheck-amount: ${bad} PROBLEM(S)\n` : "\ncheck-amount: every displayed amount is consistent and within budget\n");
process.exit(bad ? 1 : 0);
