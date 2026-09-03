// Walks the whole journey as a brand-new trader with a fresh wallet and reports
// on navigation and information architecture rather than on copy:
//   landing -> connect -> home -> build -> back -> logo -> reconnect -> activate
//
// It reports findings; it does not assert. Read the output as an audit.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "../dist");
const shots = resolve(here, "../../../qa");
if (!existsSync(shots)) mkdirSync(shots, { recursive: true });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  const url = req.url.split("?")[0];
  let file = join(dist, url === "/" ? "index.html" : url);
  if (!existsSync(file)) file = join(dist, "index.html");
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(4176, r));
const base = "http://localhost:4176";

const OWNER = "0x8827d3AF20eFe02582aEA67a5E704C04BAd52324";
const findings = [];
const note = (severity, where, what) => { findings.push({ severity, where, what }); console.log(`  [${severity}] ${where}: ${what}`); };
const step = (t) => console.log(`\n── ${t} ──`);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript((account) => {
  const provider = {
    request: async ({ method }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
      if (method === "eth_chainId") return "0xc488";
      throw Object.assign(new Error("harness does not sign"), { code: 4200 });
    },
    on() {}, removeListener() {},
  };
  window.addEventListener("eip6963:requestProvider", () => {
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
      detail: { info: { uuid: "t", name: "Test harness wallet", icon: "", rdns: "sequence.test" }, provider },
    }));
  });
}, OWNER);
const page = await context.newPage();

// Which screen are we on?
const where = () => page.evaluate(() => ({
  landing: Boolean(document.querySelector("#how-it-works")),
  home: Boolean(document.querySelector("#dashboard")),
  build: Boolean(document.querySelector("#build")),
  details: Boolean(document.querySelector("#onchain")),
  scrollY: Math.round(window.scrollY),
}));
const label = (w) => Object.entries(w).filter(([k, v]) => v === true).map(([k]) => k).join("+") || "nothing";

// ---------------------------------------------------------------- landing
step("1. Arrive as a stranger");
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
let w = await where();
console.log(`  on: ${label(w)}`);

const ctas = await page.getByRole("button").allInnerTexts();
const buildCtas = ctas.filter((t) => /build|start a sequence/i.test(t));
console.log(`  buttons that start the product: ${buildCtas.length} -> ${buildCtas.join(" / ")}`);
if (buildCtas.length > 2) note("IA", "landing", `${buildCtas.length} competing calls to action; a landing page wants one primary journey`);

// ---------------------------------------------------------------- connect from nav
step("2. Connect from the nav, expecting to stay put");
await page.getByRole("button", { name: "Connect wallet" }).first().click();
await page.getByRole("button", { name: /Test harness wallet/ }).click();
await page.waitForTimeout(2500);
w = await where();
console.log(`  on: ${label(w)}`);
if (!w.landing) note("IA", "connect", "connecting from the landing page threw the user onto another screen unasked");

// ---------------------------------------------------------------- home
step("3. Go to Your sequences");
await page.getByRole("button", { name: "Your sequences", exact: true }).click();
await page.waitForTimeout(2500);
w = await where();
console.log(`  on: ${label(w)}`);
if (!w.home) note("IA", "nav", `Your sequences went to ${label(w)}`);
const home = await page.locator("#dashboard").innerText().catch(() => "");
if (/what should happen next|read it back|quick start/i.test(home)) {
  note("IA", "your sequences", "a sequence-creation surface is embedded in the home screen, competing with Build");
}
const hasBuckets = /Drafts/.test(home) && /Live/.test(home) && /Finished/.test(home);
const hasRisk = /At risk now/i.test(home);
const hasMarkets = (await page.locator(".market-tile").count()) > 0;
console.log(`  risk summary: ${hasRisk} | market context: ${hasMarkets} | Live/Draft/Finished: ${hasBuckets}`);
if (!hasBuckets) note("IA", "your sequences", "Live / Draft / Finished are not all present");
if (!hasRisk || !hasMarkets) note("IA", "your sequences", "risk summary or market context missing");
const homeCrumb = await page.locator(".screen-header").innerText().catch(() => "");
if (!homeCrumb) note("IA", "your sequences", "no screen header telling the user where they are");
await page.screenshot({ path: join(shots, "ia-home.png"), fullPage: true });

// ---------------------------------------------------------------- logo
step("4. Click the logo from inside the product");
await page.getByLabel("Sequence home page").click();
await page.waitForTimeout(1500);
w = await where();
console.log(`  on: ${label(w)}`);
if (!w.landing) note("IA", "logo", `logo went to ${label(w)}; it must always return to the public landing page`);

// ---------------------------------------------------------------- build
step("5. Start building from the landing call to action (already connected)");
await page.getByRole("button", { name: "Build your sequence" }).first().click();
await page.waitForTimeout(2500);
w = await where();
console.log(`  on: ${label(w)}`);
if (!w.build) note("IA", "build", `the call to action went to ${label(w)}`);
if (w.home && w.build) note("IA", "build", "home and build render together; the user cannot tell which screen they are on");
const build = await page.locator("#build").innerText().catch(() => "");
const crumb = await page.locator(".screen-header").innerText().catch(() => "");
console.log(`  header says: ${crumb.replace(/\s+/g, " ").trim().slice(0, 120)}`);
const backControls = await page.getByRole("button", { name: /^← Back to/i }).allInnerTexts();
console.log(`  ways back: ${backControls.length ? backControls.join(" / ") : "none"}`);
if (!backControls.length) note("IA", "build", "no explicit way back out of the creation flow");
if (!/quick start|describe/i.test(build)) note("IA", "build", "the describe-it entry is not available in the creation flow");
await page.screenshot({ path: join(shots, "ia-build.png"), fullPage: true });

// ---------------------------------------------------------------- back
step("6. Leave the builder the way it offers");
if (backControls.length) {
  await page.getByRole("button", { name: /^← Back to/i }).first().click();
  await page.waitForTimeout(1800);
  w = await where();
  console.log(`  on: ${label(w)} (scrollY ${w.scrollY})`);
  if (!w.home) note("IA", "build back", `leaving the builder landed on ${label(w)}, not the home screen`);
}

// ---------------------------------------------------------------- disconnect / reconnect
step("7. Disconnect, then reconnect");
await page.getByRole("button", { name: /^0x/ }).first().click();
await page.waitForTimeout(600);
const disconnect = page.getByRole("button", { name: /disconnect/i });
if (await disconnect.count()) {
  await disconnect.first().click();
  await page.waitForTimeout(1500);
  w = await where();
  console.log(`  after disconnect, on: ${label(w)}`);
  if (!w.landing) note("IA", "disconnect", `disconnecting left the user on ${label(w)} rather than the public page`);
} else {
  note("IA", "wallet", "no way to disconnect from the wallet dialog");
}

await page.screenshot({ path: join(shots, "audit-final.png"), fullPage: true });

step("Findings");
if (!findings.length) console.log("  none");
else findings.forEach((f) => console.log(`  [${f.severity}] ${f.where}: ${f.what}`));

await browser.close();
server.close();
