// Drives the built Sequence app in a real browser against live Somnia data.
// Two passes: disconnected (what a judge sees first), and connected through an
// injected EIP-1193 test provider that reports the REAL vault owner address so
// the owner-gated UI can be exercised. The test provider is a controlled harness
// for UI verification only: it never signs, and any write is rejected, so a real
// wallet signature is still the only way a step gets armed.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "../dist");
const shots = resolve(here, "../../../qa");
if (!existsSync(shots)) mkdirSync(shots, { recursive: true });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer((req, res) => {
  const url = req.url.split("?")[0];
  let file = join(dist, url === "/" ? "index.html" : url);
  if (!existsSync(file)) file = join(dist, "index.html");
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(4173, r));
const base = "http://localhost:4173";

const results = [];
const check = (label, pass, detail = "") => {
  results.push({ label, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const errors = [];

async function newPage(viewport, { owner } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  if (owner) {
    await page.addInitScript((account) => {
      const provider = {
        isTestHarness: true,
        request: async ({ method }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
          if (method === "eth_chainId") return "0xc488";
          throw Object.assign(new Error("The test harness does not sign transactions."), { code: 4200 });
        },
        on() {}, removeListener() {},
      };
      window.addEventListener("eip6963:requestProvider", () => {
        window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
          detail: { info: { uuid: "test-harness", name: "Test harness wallet", icon: "", rdns: "sequence.test" }, provider },
        }));
      });
    }, owner);
  }
  return { context, page };
}

// ---------------------------------------------------------------- pass 1
{
  const { context, page } = await newPage({ width: 1440, height: 1000 });
  await page.goto(base, { waitUntil: "domcontentloaded" });

  check("landing renders the hero promise", (await page.getByRole("heading", { level: 1 }).innerText()).includes("Plan the next"));

  // Builder must populate from the live indexer, not from seeded fiction.
  await page.getByRole("button", { name: "Build your sequence" }).click();
  await page.waitForSelector("text=live markets", { timeout: 30000 });
  const marketCount = await page.locator("select").first().locator("option").count();
  check("builder loads live DreamDEX markets", marketCount > 2, `${marketCount - 1} market options`);

  const firstOption = await page.locator("select").first().locator("option").nth(1).innerText();
  check("market options carry real question text", /closes at or above|price be at or above/i.test(firstOption), firstOption.slice(0, 60));

  const pool = await page.locator("text=/^0x[0-9a-f]{40}$/i").first().innerText().catch(() => "");
  check("successor pool is a real address", /^0x[0-9a-fA-F]{40}$/.test(pool), pool);

  // Simulation
  await page.getByRole("button", { name: "Run preview" }).click();
  await page.waitForTimeout(600);
  const simText = await page.locator(".simulation-strip").innerText();
  check("simulation produces a labelled result", /settled|projected|No settled market/.test(simText));
  check("simulation is labelled as simulation", /No funds move/.test(simText));

  // Arm must be gated, not faked.
  const armGate = await page.locator("text=Connect a wallet to arm this step.").count();
  check("arm is gated behind a real wallet", armGate > 0);

  // Operations must read the live vault.
  await page.locator("#how-it-works").scrollIntoViewIfNeeded();
  await page.waitForSelector("text=/Vault 0xA9A9AA93BE8f62723D55dA5Ba100F9803325Bf62/", { timeout: 30000 });
  const ops = await page.locator("#active-sequence").innerText();
  check("operations reads live vault state", /Vault cap|Nothing armed|Reading vault/.test(ops));
  check("operations shows no fabricated sequence id", !/SEQ-02F9/.test(ops));

  const proof = await page.locator("#proof").innerText();
  check("proof shows a truthful empty state, not a fake timeline", /No SequenceVault events/.test(proof) || /0x/.test(proof));
  check("old hardcoded timeline is gone", !/13:45:02/.test(proof));

  // No dead controls on the public page.
  const anchors = await page.locator("a[href^='#']").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  const missing = [];
  for (const href of [...new Set(anchors)]) {
    if (href === "#") { missing.push(href); continue; }
    if ((await page.locator(href).count()) === 0) missing.push(href);
  }
  check("every in-page link has a destination", missing.length === 0, missing.join(", "));

  const externals = await page.locator("a[href^='http']").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  check("external links are real URLs", externals.every((h) => /^https:\/\//.test(h)), `${externals.length} links`);

  await page.screenshot({ path: join(shots, "e2e-desktop-full.png"), fullPage: true });
  await context.close();
}

// ---------------------------------------------------------------- pass 2
{
  const { context, page } = await newPage({ width: 1440, height: 1000 }, { owner: "0x8827d3AF20eFe02582aEA67a5E704C04BAd52324" });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  await page.getByRole("button", { name: /Test harness wallet/ }).click();
  await page.waitForTimeout(500);

  const nav = await page.locator("header").innerText();
  check("connected account renders from the provider", /0x8827…2324|0x8827/.test(nav), nav.split("\n").pop());

  await page.locator("#how-it-works").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
  const strip = await page.locator(".wallet-strip").innerText();
  check("owner is recognised against the onchain owner", /vault owner/.test(strip));
  check("network state is read from the provider", /Shannon/.test(strip));

  await page.locator("#build").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const armBtn = await page.getByRole("button", { name: "Arm this step" }).count();
  check("owner sees a live arm control", armBtn > 0);

  await page.locator("#how-it-works").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const goLive = await page.locator("text=Make the vault reactive").count();
  check("owner sees the go-live path", goLive > 0);
  const stake = await page.locator("text=/Send 32 SOM/").count();
  check("go-live surfaces the real subscription stake", stake > 0);

  await page.screenshot({ path: join(shots, "e2e-desktop-connected.png"), fullPage: true });
  await context.close();
}

// ---------------------------------------------------------------- pass 3
{
  const { context, page } = await newPage({ width: 390, height: 844 });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no horizontal overflow on mobile", overflow <= 1, `${overflow}px`);
  await page.screenshot({ path: join(shots, "e2e-mobile-full.png"), fullPage: true });
  await context.close();
}

const realErrors = errors.filter((e) => !/favicon|Failed to load resource/.test(e));
check("no uncaught console or page errors", realErrors.length === 0, realErrors.slice(0, 2).join(" | "));

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\ne2e: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log("failed:", failed.map((f) => f.label).join(", ")); process.exit(1); }
