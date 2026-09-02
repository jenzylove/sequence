// Walks the product the way a first-time trader would: someone who knows what
// YES/NO and stake mean, but has never heard of Somnia, Reactivity, vaults,
// market ids or anything internal to Sequence.
//
// It captures what such a user would actually see at each step, so the output
// can be read as prose rather than as assertions.
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
await new Promise((r) => server.listen(4174, r));
const base = "http://localhost:4174";

const OWNER = "0x8827d3AF20eFe02582aEA67a5E704C04BAd52324";
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript((account) => {
  const provider = {
    request: async ({ method }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
      if (method === "eth_chainId") return "0xc488";
      throw Object.assign(new Error("test harness does not sign"), { code: 4200 });
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
const say = (heading, body) => console.log(`\n── ${heading} ──\n${body}`);

await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

// 1. What does a stranger see first?
const publicText = await page.locator("body").innerText();
say("PUBLIC LANDING — everything visible", publicText.replace(/\n{2,}/g, "\n").trim());

// Does any account or protocol state leak onto the public page?
const LEAKS = [
  ["a contract address", /0x[0-9a-fA-F]{40}/],
  ["a market id", /0x[0-9a-fA-F]{64}/],
  ["chain id", /chain\s*50312/i],
  ["vault wording", /\bvault\b/i],
  ["Somnia internals", /reactivity|oraclehub|answerdelivered|precompile/i],
  ["balances", /at risk now|still free|your limit/i],
  ["raw pricefeed question", /pricefeed test/i],
];
const leaked = LEAKS.filter(([, re]) => re.test(publicText)).map(([name]) => name);
say("PUBLIC LANDING — leaks", leaked.length ? `LEAKED: ${leaked.join(", ")}` : "clean: no account or protocol state");

await page.screenshot({ path: join(shots, "j-1-landing.png"), fullPage: true });

// 2. Press the main call to action while disconnected.
await page.getByRole("button", { name: "Build your sequence" }).first().click();
await page.waitForTimeout(700);
const dialog = await page.locator("[role=dialog]").innerText().catch(() => "(no dialog)");
say("CLICKED 'Build your sequence' WHILE DISCONNECTED", dialog);
await page.screenshot({ path: join(shots, "j-2-connect.png") });

// 3. Connect, and see where it lands.
await page.getByRole("button", { name: /Test harness wallet/ }).click();
await page.waitForTimeout(2500);
const landed = await page.evaluate(() => ({
  build: Boolean(document.getElementById("build")),
  home: Boolean(document.getElementById("dashboard")),
}));
say("AFTER CONNECTING", `builder present: ${landed.build}\nhome present: ${landed.home}`);

await page.waitForSelector("#build", { timeout: 30000 });
await page.waitForTimeout(2500);
const builder = await page.locator("#build").innerText();
say("BUILDER — everything the trader reads", builder.replace(/\n{2,}/g, "\n").trim());

// Jargon that must not appear in the builder's primary surface.
const JARGON = [
  ["Outcome 0/1", /outcome [01]\b/i],
  ["bounded actions", /bounded action/i],
  ["successor", /successor/i],
  ["cap will bind", /cap will bind/i],
  ["pricefeed question", /pricefeed test/i],
  ["raw market id", /0x[0-9a-fA-F]{64}/],
  ["pool address", /0x[0-9a-fA-F]{40}/],
  ["vault", /\bvault\b/i],
  ["notional", /notional/i],
  ["arm/armed", /\barm(ed|ing)?\b/i],
  ["Somnia internals", /reactivity|oraclehub|answerdelivered/i],
];
const builderLeaks = JARGON.filter(([, re]) => re.test(builder)).map(([n]) => n);
say("BUILDER — jargon check", builderLeaks.length ? `LEAKED: ${builderLeaks.join(", ")}` : "clean: trader language only");

// The five questions must be answerable from the screen.
const ANSWERS = [
  ["What market am I watching?", /what are you watching/i],
  ["What happens if YES?", /if yes/i],
  ["What happens if NO?", /if no/i],
  ["How much can I risk?", /maximum total risk/i],
  ["What happens after I activate?", /what will happen/i],
  ["A plain preview sentence", /when .* settles, sequence/i],
  ["An explicit activate control", /activate sequence/i],
];
const unanswered = ANSWERS.filter(([, re]) => !re.test(builder)).map(([n]) => n);
say("BUILDER — can a trader answer the five questions?", unanswered.length ? `MISSING: ${unanswered.join(" | ")}` : "all answered on screen");

// The amount a trader types must be the amount shown everywhere else.
const perTrade = await page.getByLabel("Amount per trade").inputValue();
const branchAmounts = await page.locator(".branch-row").allInnerTexts();
const consistent = branchAmounts.every((t) => t.includes(`$${Number(perTrade).toLocaleString()}`));
say("BUILDER — is the per-trade amount consistent?",
  consistent ? `yes: $${perTrade} on the input and on both branches`
             : `NO: input says $${perTrade}, branches say ${branchAmounts.join(" / ")}`);

// Changing it must keep every number in step.
await page.getByLabel("Amount per trade").fill("4");
await page.getByLabel("Amount per trade").blur();
await page.waitForTimeout(500);
const after = await page.getByLabel("Amount per trade").inputValue();
const afterBranches = await page.locator(".branch-row").allInnerTexts();
say("BUILDER — after typing 4",
  `input settles at $${after}; branches show ${afterBranches.map((t) => t.replace(/\s+/g, " ").trim()).join(" / ")}`);

await page.screenshot({ path: join(shots, "j-3-builder.png"), fullPage: true });

// 4. The market picker a trader must choose from.
const options = await page.locator("select[aria-label='Market to watch'] option").allInnerTexts();
say("MARKET PICKER — what the options look like", options.slice(0, 8).join("\n"));

// 5. Home view.
await page.getByRole("button", { name: "Your sequences", exact: true }).click();
await page.waitForSelector("#dashboard", { timeout: 20000 });
await page.waitForTimeout(2000);
const home = await page.locator("#dashboard").innerText();
say("HOME — drafts / live / finished", home.replace(/\n{2,}/g, "\n").trim().slice(0, 1400));
await page.screenshot({ path: join(shots, "j-4-home.png"), fullPage: true });

await browser.close();
server.close();
