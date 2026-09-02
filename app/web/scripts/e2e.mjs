// Drives the built Sequence app in a real browser against live Somnia data.
// Four passes: metadata, the public landing, the connected desk (through an
// injected EIP-1193 test provider reporting the REAL account owner so
// owner-gated UI can be exercised), and mobile. The test provider never signs:
// any write is rejected, so a real wallet signature remains the only way
// anything goes live.
//
// Beyond wiring, this suite checks COMPREHENSION: the primary surface must not
// leak contract vocabulary, and what a trader needs to know must be on screen
// without opening anything.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "../dist");
const shots = resolve(here, "../../../qa");
if (!existsSync(shots)) mkdirSync(shots, { recursive: true });

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json",
};
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

// Vocabulary that must never appear in the primary reading path. These belong
// behind "Onchain details" only.
const JARGON = [
  "armStep", "SequenceVault", "OracleHub", "Reactivity", "notional",
  "subscriptionId", "AnswerDelivered", "topic0", "bytes32", "successor pool",
  "marketId", "calldata", "precompile", "idempotent", "vault",
];

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

const connect = async (page, { land = "home" } = {}) => {
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  await page.getByRole("button", { name: /Test harness wallet/ }).click();
  await page.waitForSelector(land === "build" ? "#build" : "#dashboard", { timeout: 30000 });
};

// Connecting from the nav's Connect wallet lands on home; the product's own
// call to action lands in the builder. Both routes are exercised.
const connectViaBuild = async (page) => {
  await page.getByRole("button", { name: "Build your sequence" }).first().click();
  await page.getByRole("button", { name: /Test harness wallet/ }).click();
  await page.waitForSelector("#build", { timeout: 30000 });
};

// ---------------------------------------------------------------- metadata
{
  const { context, page } = await newPage({ width: 1440, height: 1000 });
  await page.goto(base, { waitUntil: "domcontentloaded" });

  const title = await page.title();
  check("page title names the product and its promise", /sequence/i.test(title) && /happens next/i.test(title), title);
  const desc = await page.locator('meta[name="description"]').getAttribute("content");
  check("description is written for a trader", /follow-on trade/i.test(desc));
  check("favicon is wired", (await page.locator('link[rel="icon"]').count()) > 0);
  check("web manifest is wired", (await page.locator('link[rel="manifest"]').count()) > 0);
  const ogOk = (await page.locator('meta[property="og:title"]').count()) > 0 && (await page.locator('meta[name="twitter:card"]').count()) > 0;
  check("social preview metadata present", ogOk);
  for (const asset of ["/favicon.svg", "/manifest.webmanifest", "/og.svg"]) {
    const res = await page.request.get(base + asset);
    check(`asset ${asset} is served`, res.status() === 200, `HTTP ${res.status()}`);
  }
  await context.close();
}

// ---------------------------------------------------------------- landing
{
  const { context, page } = await newPage({ width: 1440, height: 1000 });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  check("landing states the promise up front", (await page.getByRole("heading", { level: 1 }).innerText()).includes("Plan the next"));
  check("landing explains how it works", (await page.locator("#how-it-works").count()) === 1);

  // A landing page, not a console: no account or protocol state may appear.
  const publicText = await page.locator("body").innerText();
  const publicLeaks = [
    ["contract address", /0x[0-9a-fA-F]{40}/],
    ["market id", /0x[0-9a-fA-F]{64}/],
    ["chain id", /chain\s*50312/i],
    ["vault wording", /vault/i],
    ["protocol internals", /reactivity|oraclehub|answerdelivered|precompile/i],
    ["account balances", /at risk now|still free|your limit/i],
    ["raw pricefeed question", /pricefeed test/i],
  ].filter(([, re]) => re.test(publicText)).map(([n]) => n);
  check("public landing leaks no account or protocol state", publicLeaks.length === 0, publicLeaks.join(", "));
  check("builder is not exposed before connecting", (await page.locator("#build").count()) === 0);

  // The main call to action must start the product, not scroll to nothing.
  await page.getByRole("button", { name: "Build your sequence" }).first().click();
  await page.waitForTimeout(500);
  const ask = await page.locator("[role=dialog]").innerText();
  check("Build your sequence asks for a wallet first", /Connect a wallet to build a sequence/i.test(ask));

  await page.screenshot({ path: join(shots, "e2e-landing.png"), fullPage: true });
  await context.close();
}

// ---------------------------------------------------------------- the desk
{
  const { context, page } = await newPage({ width: 1440, height: 1000 }, { owner: "0x8827d3AF20eFe02582aEA67a5E704C04BAd52324" });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await connectViaBuild(page);
  check("the call to action lands in the builder, not a dashboard", (await page.locator("#build").count()) === 1);

  await page.getByRole("button", { name: "Your sequences", exact: true }).click();
  await page.waitForSelector(".risk-summary", { timeout: 45000 });
  await page.waitForSelector(".market-tile", { timeout: 45000 });

  const dash = await page.locator("#dashboard").innerText();

  check("connecting lands on the desk, not the landing page", (await page.locator("#dashboard").count()) === 1);
  check("desk shows what is at risk and the limit", /At risk now/i.test(dash) && /Your limit/i.test(dash));
  check("desk shows free headroom", /Still free/i.test(dash));
  check("desk offers Drafts / Live / Finished", /Drafts/.test(dash) && /Live/.test(dash) && /Finished/.test(dash));
  check("desk has a New sequence button", (await page.getByRole("button", { name: "New sequence" }).count()) > 0);
  check("desk has a clear new-sequence entry point", /What should happen next\?/i.test(dash));

  // The risk limit is a real onchain setting, reachable from the headline number.
  await page.getByLabel("Change your risk limit").click();
  await page.waitForTimeout(400);
  const limit = await page.locator("[role=dialog]").innerText();
  check("risk limit is explained and changeable", /The most you can have at risk/i.test(limit) && /Funds in your account/i.test(limit));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  const strip = await page.locator(".market-strip").innerText();
  check("live market context is present", /BTC|ETH/.test(strip), strip.split("\n").slice(0, 3).join(" / "));
  check("settlement countdown is shown", /settles in|settling now/i.test(strip));

  const leaked = JARGON.filter((j) => dash.toLowerCase().includes(j.toLowerCase()));
  check("no contract vocabulary on the primary surface", leaked.length === 0, leaked.join(", "));

  const input = page.getByLabel("Describe the sequence you want");
  await input.fill("roll BTC three times, $2 a trade, $5 total");
  await page.getByRole("button", { name: "Read it back" }).click();
  await page.waitForTimeout(900);
  const readback = await page.locator(".command-card").innerText();
  check("plain English becomes a readable plan", /Here is what that does/i.test(readback));
  check("plan explains both outcomes", /closes up/i.test(readback) && /closes down/i.test(readback));
  check("plan states the worst case", /Most you can lose/i.test(readback));
  check("plan offers explicit activation", (await page.getByRole("button", { name: /Review and activate/ }).count()) > 0);

  await input.fill("roll DOGE twice");
  await page.getByRole("button", { name: "Read it back" }).click();
  await page.waitForTimeout(600);
  check("unknown market is refused, not invented", /rolling BTC and ETH markets/i.test(await page.locator(".command-card").innerText()));

  await input.fill("what is happening right now?");
  await page.getByRole("button", { name: "Read it back" }).click();
  await page.waitForTimeout(600);
  const explained = await page.locator(".command-card").innerText();
  check("it can explain current state in plain words", /committed against|Nothing is live|still reading/i.test(explained));

  await input.fill("roll BTC twice, $2 a trade, $4 total");
  await page.getByRole("button", { name: "Read it back" }).click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /Review and activate/ }).click();
  await page.waitForTimeout(600);
  const dialog = await page.locator("[role=dialog]").innerText();
  check("activation shows the worst case before signing", /The most you can lose/i.test(dialog));
  check("activation button states the risk", /Put it live/i.test(dialog));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  await page.getByRole("button", { name: /^Drafts/ }).click();
  await page.waitForTimeout(400);
  const draftPanel = await page.locator(".sequence-panel").innerText();
  check("reviewed sequence is saved as a draft", /Activate/.test(draftPanel));
  // Reviewing the same plan twice must update one draft, not pile up copies.
  const before = await page.locator(".sequence-row").count();
  await page.getByRole("button", { name: /Review and activate/ }).click();
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const after = await page.locator(".sequence-row").count();
  check("re-reviewing does not duplicate the draft", after === before, `${before} then ${after}`);

  await page.screenshot({ path: join(shots, "e2e-desk.png"), fullPage: true });

  await page.getByRole("button", { name: "Build", exact: true }).click();
  await page.waitForSelector("#build", { timeout: 20000 });
  await page.waitForTimeout(1200);
  const builder = await page.locator("#build").innerText();

  // The five questions a trader needs answered, on screen, without docs.
  const unanswered = [
    ["what am I watching", /what are you watching/i],
    ["what if YES", /if yes/i],
    ["what if NO", /if no/i],
    ["how much can I risk", /maximum total risk/i],
    ["what happens after activating", /what will happen/i],
    ["a plain preview sentence", /when .* settles, sequence buys/i],
    ["an explicit activate control", /activate sequence/i],
  ].filter(([, re]) => !re.test(builder)).map(([n]) => n);
  check("builder answers the five trader questions", unanswered.length === 0, unanswered.join(" | "));

  const builderJargon = [
    ["Outcome 0/1", /outcome [01]/i],
    ["bounded actions", /bounded action/i],
    ["successor", /successor/i],
    ["cap will bind", /cap will bind/i],
    ["pricefeed question", /pricefeed test/i],
    ["raw market id", /0x[0-9a-fA-F]{64}/],
    ["pool address", /0x[0-9a-fA-F]{40}/],
    ["vault", /vault/i],
    ["notional", /notional/i],
    ["arm/armed", /arm(ed|ing)?/i],
  ].filter(([, re]) => re.test(builder)).map(([n]) => n);
  check("builder carries no contract vocabulary", builderJargon.length === 0, builderJargon.join(", "));
  check("builder keeps raw ids behind a disclosure", /Onchain details/i.test(builder));

  // One amount, shown the same everywhere.
  const perTrade = await page.getByLabel("Amount per trade").inputValue();
  const branchText = (await page.locator(".branch-row").allInnerTexts()).join(" ");
  check("per-trade amount matches both branches", branchText.includes(`$${Number(perTrade).toLocaleString()}`), `input $${perTrade}`);

  // Market names must read like markets, not like protocol records.
  const firstMarket = await page.locator("select[aria-label='Market to watch'] option").nth(1).innerText();
  check("markets are named the way traders name them", /^(BTC|ETH) \d+[smhd]/.test(firstMarket.trim()), firstMarket.trim());

  await page.getByRole("button", { name: "Onchain details", exact: true }).first().click();
  await page.waitForTimeout(1200);
  const details = await page.locator("#how-it-works").innerText();
  check("onchain details surface exposes the raw record", /AnswerDelivered|0xA9A9AA93/i.test(details));
  check("go-live is framed as one-time setup", /One-time setup/i.test(details));

  await page.screenshot({ path: join(shots, "e2e-details.png"), fullPage: true });
  await context.close();
}

// ---------------------------------------------------------------- mobile
{
  const { context, page } = await newPage({ width: 390, height: 844 }, { owner: "0x8827d3AF20eFe02582aEA67a5E704C04BAd52324" });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("landing has no horizontal overflow on mobile", overflow <= 1, `${overflow}px`);

  await connect(page, { land: "home" });
  await page.waitForSelector(".risk-summary", { timeout: 45000 });
  overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("desk has no horizontal overflow on mobile", overflow <= 1, `${overflow}px`);

  const mobileDash = await page.locator("#dashboard").innerText();
  check("mobile desk still shows risk and markets", /At risk now/i.test(mobileDash) && /(BTC|ETH)/.test(mobileDash));

  const tap = await page.getByLabel("Describe the sequence you want").boundingBox();
  check("command input is comfortably tappable", Boolean(tap && tap.height >= 32), tap ? `${Math.round(tap.height)}px` : "missing");

  await page.screenshot({ path: join(shots, "e2e-mobile-desk.png"), fullPage: true });
  await context.close();
}

const realErrors = errors.filter((e) => !/favicon|Failed to load resource|manifest/i.test(e));
check("no uncaught console or page errors", realErrors.length === 0, realErrors.slice(0, 2).join(" | "));

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\ne2e: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log("failed:", failed.map((f) => f.label).join(", ")); process.exit(1); }
