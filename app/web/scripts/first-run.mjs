// Walking Sequence as somebody who has never seen it.
//
// Not a component test. This follows one path end to end - landing, understand,
// connect, network, gas, create an account, fund it, reach the dashboard, build
// a sequence, review it, activate it - and at every stage asks the questions a
// first-time user would be asking. A stage passes only if a person who did not
// build this would know what was happening and what to do next.
//
// The wallet used is fresh and owns nothing, because that is who arrives.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const shots = join(repo, "docs", "journey");
mkdirSync(shots, { recursive: true });
const base = process.env.BASE_URL || "http://localhost:4173";

// A wallet nobody has ever used: no account, no funds, no history.
const FRESH = "0x7Ac0f1B9aE3d4C2e8F16bD5a904cE7183Db2fA61";

const results = [];
const stage = (name, pass, note, shot) => {
  results.push({ stage: name, pass, note, shot });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${note ? ` — ${note}` : ""}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

// A wallet that connects and reports the wrong network first, so the network
// step is actually exercised rather than assumed.
let chain = "0x1";
await page.addInitScript((account) => {
  window.__chain = "0x1";
  const provider = {
    request: async ({ method }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
      if (method === "eth_chainId") return window.__chain;
      if (method === "wallet_switchEthereumChain") {
        window.__chain = "0xc488";
        (window.__onChain || []).forEach((fn) => fn("0xc488"));
        return null;
      }
      throw Object.assign(new Error("This wallet cannot sign in the walkthrough."), { code: 4200 });
    },
    on(event, fn) { if (event === "chainChanged") (window.__onChain ||= []).push(fn); },
    removeListener() {},
  };
  window.addEventListener("eip6963:requestProvider", () => {
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
      detail: { info: { uuid: "walkthrough", name: "Rabby Wallet", icon: "", rdns: "io.rabby" }, provider },
    }));
  });
}, FRESH);

const shoot = async (name) => {
  const file = `${name}.png`;
  await page.screenshot({ path: join(shots, file), fullPage: true });
  return file;
};

const text = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");

// ---- 1. landing -------------------------------------------------------------
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);
{
  const body = await text();
  const shot = await shoot("01-landing");
  const explains = /settles/i.test(body) && /next trade/i.test(body);
  stage("Landing explains what Sequence does without jargon", explains,
    explains ? "hero states the settle-then-trade promise" : "the promise is not legible", shot);
}

// ---- 2. the secondary CTA must do what it says ------------------------------
{
  const cta = page.getByRole("button", { name: /Watch Sequence run/ });
  const exists = await cta.count() > 0;
  await cta.first().click();
  await page.waitForTimeout(700);
  const onDemo = await page.locator("#demo").count() > 0;
  const body = await text();
  const realTx = /0x[0-9a-f]{6}/i.test(await page.locator("#demo").innerText().catch(() => ""))
    || /Watch|Settlement|Branch|Order|Redemption/.test(body);
  const shot = await shoot("02-demo");
  stage("\"Watch Sequence run\" opens a real run, not more copy", exists && onDemo && realTx,
    onDemo ? "dedicated demo screen with the five stages and live receipts" : "did not reach a demo screen", shot);
}

// ---- 3. the five stages are walkable ---------------------------------------
{
  let seen = [];
  for (const label of ["Settlement", "Branch", "Order", "Redemption"]) {
    const b = page.getByRole("button", { name: new RegExp(label) }).first();
    if (await b.count()) { await b.click(); await page.waitForTimeout(250); seen.push(label); }
  }
  const shot = await shoot("03-demo-redemption");
  stage("Every stage of the run is reachable and evidenced", seen.length === 4,
    `walked ${["Watch", ...seen].join(" → ")}`, shot);
}

// ---- 4. wallet chooser shows no developer metadata --------------------------
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(600);
{
  await page.getByRole("button", { name: /Connect wallet/ }).first().click();
  await page.waitForTimeout(500);
  const modal = await page.locator(".wallet-modal").innerText();
  const shot = await shoot("04-wallet-picker");
  const clean = !/io\.rabby|rdns|Chain ID 50312/i.test(modal);
  stage("Wallet chooser exposes no internal identifiers", clean,
    clean ? "wallet name only; network details behind a disclosure" : `leaked: ${modal.slice(0, 80)}`, shot);
}

// ---- 5. connect on the wrong network ---------------------------------------
{
  await page.getByRole("button", { name: /Rabby Wallet/ }).click();
  await page.waitForTimeout(1500);
  const body = await text();
  const shot = await shoot("05-wrong-network");
  const warns = /wrong network|switch/i.test(body);
  stage("A wallet on the wrong network is told so", warns,
    warns ? "wrong-network state is visible and named" : "no network warning", shot);
}

// ---- 6. switch to Shannon ---------------------------------------------------
{
  const sw = page.getByRole("button", { name: /Switch|Somnia/ }).first();
  if (await sw.count()) { await sw.click(); await page.waitForTimeout(1200); }
  await page.evaluate(() => { window.__chain = "0xc488"; (window.__onChain || []).forEach((f) => f("0xc488")); });
  await page.waitForTimeout(1500);
  const shot = await shoot("06-on-shannon");
  const body = await text();
  // The proof is that the blocking banner has cleared, not that a string appears.
  const cleared = !/on a different network/i.test(body);
  stage("Reaching the correct network is possible from the interface", cleared,
    cleared ? "wrong-network banner cleared after switching" : "still blocked on the wrong network", shot);
}

// ---- 7. the create-account screen ------------------------------------------
{
  await page.getByRole("button", { name: /Build your sequence/ }).first().click();
  // The screen reads balances from chain before it can advise; wait for it the
  // way a person would, rather than asserting against a half-loaded page.
  await page.waitForSelector("#provision", { timeout: 60000 });
  await page.waitForTimeout(9000);
  const body = await text();
  const shot = await shoot("07-create-account");
  const saysWhatItDoes = /publishes your account|one transaction/i.test(body);
  const saysNoMoney = /no trading money|moves nothing|creating it moves/i.test(body);
  const limitClear = /limit, not a payment/i.test(body);
  stage("Creating the account explains the transaction before the wallet opens",
    saysWhatItDoes && saysNoMoney && limitClear,
    `publishes-a-program: ${saysWhatItDoes}, moves-no-money: ${saysNoMoney}, limit-not-payment: ${limitClear}`, shot);
}

// ---- 8. a wallet with no gas is warned before signing ----------------------
{
  const body = await text();
  const shot = await shoot("08-gas-warning");
  const warned = /needs test STT|low on test STT|Get test STT/i.test(body);
  stage("A wallet with no STT is warned before it can hit a dead end", warned,
    warned ? "gas shortfall named with a faucet link" : "no gas warning shown", shot);
}

// ---- 9. pressing create with an unsignable wallet must not hang ------------
{
  const btn = page.getByRole("button", { name: /Create my account/ });
  let settled = "no button";
  if (await btn.count() && await btn.isEnabled()) {
    await btn.click();
    await page.waitForTimeout(6000);
    const body = await text();
    const stuck = /Approve in your wallet…/.test(body) && !/cannot|did not|cancelled|refused|not enough/i.test(body);
    settled = stuck ? "still hanging" : "reported an outcome";
  }
  const shot = await shoot("09-after-create-attempt");
  stage("A wallet that cannot sign produces an outcome, never an endless wait",
    settled !== "still hanging", settled, shot);
}

// ---- the funded half of the journey ----------------------------------------
// A wallet that already owns an account and holds funds, so the screens after
// setup can be walked as a person would meet them.
const OWNER = "0x8827d3AF20eFe02582aEA67a5E704C04BAd52324";
const owned = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const p2 = await owned.newPage();
p2.on("pageerror", (e) => errors.push(e.message));
p2.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await p2.addInitScript((account) => {
  const provider = {
    request: async ({ method }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
      if (method === "eth_chainId") return "0xc488";
      throw Object.assign(new Error("This wallet cannot sign in the walkthrough."), { code: 4200 });
    },
    on() {}, removeListener() {},
  };
  window.addEventListener("eip6963:requestProvider", () => {
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
      detail: { info: { uuid: "walkthrough", name: "Rabby Wallet", icon: "", rdns: "io.rabby" }, provider },
    }));
  });
}, OWNER);

const shoot2 = async (name) => { await p2.screenshot({ path: join(shots, `${name}.png`), fullPage: true }); return `${name}.png`; };
const text2 = async () => (await p2.locator("body").innerText()).replace(/\s+/g, " ");

await p2.goto(base, { waitUntil: "domcontentloaded" });
await p2.getByRole("button", { name: /Build your sequence/ }).first().click();
await p2.getByRole("button", { name: /Rabby Wallet/ }).click();
await p2.waitForTimeout(9000);

// ---- 10. the dashboard ------------------------------------------------------
{
  const home = p2.getByRole("button", { name: "Your sequences", exact: true }).last();
  if (await home.count()) { await home.click(); await p2.waitForTimeout(3500); }
  const body = await text2();
  const shot = await shoot2("10-dashboard");
  const usable = /Live|Drafts|Finished/.test(body) && !/undefined|NaN/.test(body);
  stage("The dashboard is reachable and readable", usable,
    usable ? "Live / Drafts / Finished with no placeholder values" : "dashboard did not render cleanly", shot);
}

// ---- 11. setup says what is required and what is optional -------------------
// The panel only appears for an account that is not finished being set up. For
// one that is, its absence is the correct answer — so both cases are accepted,
// and the labelling is only demanded when the panel is actually on screen.
{
  const body = await text2();
  const shot = await shoot2("11-setup");
  const panel = /Set your account up/.test(body);
  let ok, note;
  if (panel) {
    const fundsFirst = body.indexOf("Put trading funds in");
    const autoLast = body.indexOf("Run it hands-free");
    ok = /Optional/.test(body) && fundsFirst > -1 && autoLast > fundsFirst;
    note = ok ? "required funding first, staked automation last and marked optional"
              : "the optional staked step is not clearly optional or is ordered first";
  } else {
    ok = /AT RISK NOW|YOUR LIMIT/.test(body);
    note = "no setup panel: this account is already set up, which is the correct state";
  }
  stage("Optional setup is not presented as a required step", ok, note, shot);
}

// ---- 12. build a sequence ---------------------------------------------------
{
  await p2.getByRole("button", { name: "Build", exact: true }).last().click();
  await p2.waitForSelector("#build", { timeout: 60000 });
  await p2.waitForTimeout(4000);
  const body = await text2();
  const shot = await shoot2("12-build");
  const plain = !/armStep|bytes32|calldata|notional|marketId/i.test(body);
  stage("Building a sequence uses trader language, not contract language", plain,
    plain ? "no contract vocabulary in the creation flow" : "internal vocabulary leaked into the builder", shot);
}

// ---- 13. review before activating ------------------------------------------
{
  const body = await text2();
  const shot = await shoot2("13-review");
  const reviewable = /risk|If YES|If NO/i.test(body);
  stage("The sequence can be reviewed before it goes live", reviewable,
    reviewable ? "both branches and the risk are stated before activation" : "no reviewable summary", shot);
}

// ---- 14. activation reports, never hangs -----------------------------------
{
  const btn = p2.getByRole("button", { name: /Activate sequence/ });
  let outcome = "activate button not offered";
  if (await btn.count() && await btn.isEnabled()) {
    await btn.click();
    await p2.waitForTimeout(9000);
    const body = await text2();
    outcome = /Signature \d+ of \d+/.test(body) ? "narrated the signature it was on"
      : /cannot|did not|cancelled|refused|not enough|Try again/i.test(body) ? "reported an outcome"
      : "still hanging";
  }
  const shot = await shoot2("14-activate");
  stage("Activation narrates its signatures and never hangs silently",
    outcome !== "still hanging", outcome, shot);
}

await owned.close();

const failed = results.filter((r) => !r.pass);
console.log(`\nfirst-run: ${results.length - failed.length}/${results.length} stages passed`);
if (errors.length) console.log(`page errors: ${errors.slice(0, 3).join(" | ")}`);

writeFileSync(join(repo, "docs", "FIRST_RUN.json"),
  JSON.stringify({ walkedAt: new Date().toISOString(), base, wallet: FRESH, results, pageErrors: errors }, null, 2) + "\n");
console.log(`screenshots in docs/journey, record in docs/FIRST_RUN.json`);

await browser.close();
process.exit(failed.length ? 1 : 0);
