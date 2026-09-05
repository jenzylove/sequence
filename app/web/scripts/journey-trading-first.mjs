// The trading-first journey, walked in the browser.
//
// Two wallets, both in states a real trader is actually in:
//   - one holding gas and test USDC with NO Sequence account, which is how
//     everybody arrives. It must reach the Builder and build a whole sequence.
//   - one that has been through activation, to check the dashboard leads with
//     trading rather than with our setup steps.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const shots = join(repo, "docs", "journey-v2");
mkdirSync(shots, { recursive: true });
const base = process.env.BASE_URL || "http://localhost:4173";

const NO_ACCOUNT = readFileSync(join(repo, "docs", "SHOWCASE_KEY.txt"), "utf8").trim().split("\n")[0];
const ACTIVATED = readFileSync(join(repo, "docs", "TRADING_FIRST_KEY.txt"), "utf8").trim().split("\n")[0];

const results = [];
const stage = (name, pass, note, shot) => {
  results.push({ stage: name, pass, note, shot });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${note ? ` — ${note}` : ""}`);
};

const browser = await chromium.launch();
const errors = [];

async function pageFor(account) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.addInitScript((a) => {
    const provider = {
      request: async ({ method }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [a];
        if (method === "eth_chainId") return "0xc488";
        throw Object.assign(new Error("This wallet cannot sign in the walkthrough."), { code: 4200 });
      },
      on() {}, removeListener() {},
    };
    window.addEventListener("eip6963:requestProvider", () => {
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
        detail: { info: { uuid: "walk", name: "Rabby Wallet", icon: "" }, provider },
      }));
    });
  }, account);
  return { ctx, page };
}

const shoot = async (page, name) => { await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true }); return `${name}.png`; };
const body = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");

// ---- the wallet with no account --------------------------------------------
{
  const { ctx, page } = await pageFor(NO_ACCOUNT);
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  stage("Landing is reachable", true, "public page", await shoot(page, "01-landing"));

  await page.getByRole("button", { name: /Build your sequence/ }).first().click();
  await page.getByRole("button", { name: /Rabby Wallet/ }).click();
  await page.waitForSelector("#build", { timeout: 60000 });
  // Markets come from the indexer, so wait for the builder to actually have a
  // sequence in it rather than for an arbitrary number of seconds.
  await page.getByRole("button", { name: /Activate sequence/ })
    .waitFor({ timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const t = await body(page);
  const onBuilder = (await page.locator("#build").count()) > 0;
  const notOnboarding = !/Create your trading account/i.test(t);
  stage("A wallet with no account lands in the Builder, not onboarding",
    onBuilder && notOnboarding,
    onBuilder ? "the Builder rendered with no vault in existence" : "was diverted away from building",
    await shoot(page, "02-builder-no-account"));

  const hasMarkets = /settles in|closes higher/i.test(t);
  stage("The Builder shows live markets before any infrastructure exists", hasMarkets,
    hasMarkets ? "live market windows are selectable" : "no markets visible", await shoot(page, "03-builder-markets"));

  // Activation is where infrastructure appears, and only then.
  const act = page.getByRole("button", { name: /Activate sequence/ });
  let dialogNote = "activate not offered";
  let dialogOk = false;
  if (await act.count() && await act.isEnabled()) {
    await act.click();
    await page.waitForTimeout(2500);
    const d = await body(page);
    const explains = /needs a personal trading account/i.test(d);
    const usesStrategyLimit = /enforce the \$/i.test(d);
    dialogOk = explains && usesStrategyLimit;
    dialogNote = dialogOk ? "explains the account in one sentence and quotes the limit the trader just chose" : d.slice(0, 120);
  }
  stage("Account creation appears at activation, tied to the sequence", dialogOk, dialogNote,
    await shoot(page, "04-activate-creates-account"));

  await ctx.close();
}

// ---- the wallet that has been through activation ---------------------------
{
  const { ctx, page } = await pageFor(ACTIVATED);
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Build your sequence/ }).first().click();
  await page.getByRole("button", { name: /Rabby Wallet/ }).click();
  await page.waitForTimeout(6000);
  const home = page.getByRole("button", { name: "Your sequences", exact: true }).last();
  if (await home.count()) { await home.click(); }
  await page.waitForSelector("#dashboard", { timeout: 60000 });
  // The balance strip only renders once vault state has been read.
  await page.getByRole("button", { name: "fund", exact: true }).waitFor({ timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const t = await body(page);
  const noSetupCards = !/Put trading funds in/.test(t) && !/Set your account up/.test(t);
  const leadsWithTrading = /At risk now|Balance|Markets right now/i.test(t);
  stage("The dashboard leads with trading, not setup cards", noSetupCards && leadsWithTrading,
    noSetupCards ? "no three-card setup block; balance and markets lead" : "setup cards still dominate",
    await shoot(page, "05-dashboard"));

  const fund = page.getByRole("button", { name: "fund", exact: true });
  let fundOk = false; let fundNote = "no fund action next to the balance";
  if (await fund.count()) {
    await fund.click();
    await page.waitForTimeout(6000);
    const f = await body(page);
    // Labels are rendered uppercase by CSS, so compare case-insensitively.
    fundOk = /your wallet/i.test(f) && /sequence account/i.test(f) && /fund sequence/i.test(f);
    fundNote = fundOk ? "wallet balance, account balance, amount and a Fund Sequence action" : f.slice(0, 120);
  }
  stage("Funding is in-app, with both balances shown", fundOk, fundNote, await shoot(page, "06-fund-panel"));

  const f2 = await body(page);
  const noDeadFaucet = !/Get test USDC/.test(f2);
  stage("No faucet prompt for a wallet that already holds test USDC", noDeadFaucet,
    noDeadFaucet ? "faucet help is not shown to a funded wallet" : "still offering a faucet to a funded wallet",
    await shoot(page, "07-no-faucet-prompt"));

  const auto = page.getByRole("button", { name: /Automation/ });
  let autoOk = false; let autoNote = "no automation setting found";
  if (await auto.count()) {
    await auto.first().click();
    await page.waitForTimeout(1200);
    const a = await body(page);
    autoOk = /32\.00 STT/.test(a) && /Check result/.test(a);
    autoNote = autoOk ? "stake is a collapsed setting and states the manual alternative honestly" : a.slice(0, 120);
  }
  stage("The 32 STT stake is an optional setting, not onboarding", autoOk, autoNote,
    await shoot(page, "08-automation"));

  await ctx.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\ntrading-first journey: ${results.length - failed.length}/${results.length} stages passed`);
if (errors.length) console.log(`page errors: ${[...new Set(errors)].slice(0, 3).join(" | ")}`);
writeFileSync(join(repo, "docs", "JOURNEY_V2.json"),
  JSON.stringify({ walkedAt: new Date().toISOString(), noAccountWallet: NO_ACCOUNT, activatedWallet: ACTIVATED, results, pageErrors: [...new Set(errors)] }, null, 2) + "\n");

await browser.close();
process.exit(failed.length ? 1 : 0);
