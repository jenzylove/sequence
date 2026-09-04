// Reads the real chain and the real source to report what is actually blocking
// a demo, rather than relying on anyone's recollection.
//
// Every line is either a contract read or a check against committed code. Where
// something needs a human wallet action, it says so.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { publicClient, readVaultState } from "../src/chain/vault.js";
import { vaultAbi } from "../src/chain/abi.js";
import { erc20Abi } from "../src/chain/erc20.js";
import { SHANNON } from "../src/chain/config.js";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(web, "../..");
const src = (p) => readFileSync(join(repo, p), "utf8");
const SOM = (raw) => `${(Number(raw) / 1e18).toFixed(2)} SOM`;
const USD = (raw) => `$${(Number(raw) / 1e6).toFixed(2)}`;

const rows = [];
const add = (id, area, state, detail, action = null) => {
  rows.push({ id, area, state, detail, action });
};

const state = await readVaultState().catch(() => null);

// ---------------------------------------------------------------- deployment
if (!state) {
  add("11", "deployment", "BLOCKED", `cannot read the vault at ${SHANNON.vault}`);
} else {
  let abiMatches = true;
  try {
    const probe = await publicClient().readContract({
      address: SHANNON.vault, abi: vaultAbi, functionName: "steps", args: [`0x${"00".repeat(32)}`],
    });
    abiMatches = Array.isArray(probe) && probe.length === 14;
  } catch { abiMatches = false; }

  add("11a", "deployment", abiMatches ? "OK" : "BLOCKED",
    abiMatches ? `deployed contract matches this build (${SHANNON.vault})` : "deployed contract is a version behind this build",
    abiMatches ? null : "run app/web/scripts/deploy-vault.sh");

  add("11b", "reactivity", state.subscribed ? "OK" : "BLOCKED",
    state.subscribed ? `subscription ${state.subscriptionId} is live` : "no subscription: settlements will never reach the vault",
    state.subscribed ? null : "Onchain details -> One-time setup -> Start listening");

  // Once a subscription is open the stake has already been accepted; the
  // balance drifts slightly below 32 as the vault pays its own costs.
  const staked = state.subscribed || state.native >= 32n * 10n ** 18n;
  add("11c", "reactivity", staked ? "OK" : "BLOCKED",
    state.subscribed
      ? `stake accepted; vault holds ${SOM(state.native)}`
      : `vault holds ${SOM(state.native)} of the 32 SOM stake the subscription requires`,
    staked ? null : "Onchain details -> One-time setup -> Add the shortfall");

  add("11d", "funding", state.bankroll > 0n ? "OK" : "BLOCKED",
    `vault holds ${USD(state.bankroll)} of collateral`,
    state.bankroll > 0n ? null : "send test USDC to the vault");

  // Allowance is what actually lets a pool draw the collateral.
  let allowed = 0n;
  try {
    allowed = await publicClient().readContract({
      address: state.collateral,
      abi: [...erc20Abi, { type: "function", stateMutability: "view", name: "allowance", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] }],
      functionName: "allowance",
      args: [SHANNON.vault, SHANNON.binaryModule],
    });
  } catch { /* allowance is per-pool; module is only a smoke check */ }
  const allPools = /ensurePoolAllowances/.test(src("app/web/src/components/Builder.jsx"))
    && /ensurePoolAllowances/.test(src("app/web/src/components/GoLive.jsx"));
  add("9", "permissions", allPools ? "OK" : "PARTIAL",
    allPools
      ? "every pool a sequence could execute against is approved before arming, not just the first"
      : `setup approves only the first pool of an armed step (module allowance reads ${USD(allowed)})`,
    allPools ? null : "approve the pool that will actually execute, per successor market");

  add("4b", "risk", state.outstanding === 0n ? "OK" : "CHECK",
    `${USD(state.outstanding)} committed against a ${USD(state.maxOutstanding)} limit`);
}

// ---------------------------------------------------------------- source
const vaultSol = src("src/SequenceVault.sol");
const builder = src("app/web/src/components/Builder.jsx");
const goLive = src("app/web/src/components/GoLive.jsx");
const strategy = src("app/web/src/strategy.js");
const useVault = src("app/web/src/hooks/useVault.js");
const contracts = readdirSync(join(repo, "src"));

const hasFactory = contracts.some((f) => /Factory|Registry/i.test(f));
add("1", "multi-user", hasFactory ? "OK" : "BLOCKED",
  hasFactory ? "a factory/registry exists" : "single shared vault: another wallet sees this vault and cannot arm",
  hasFactory ? null : "add a per-wallet vault factory and resolve the vault from the connected account");

const strategySrc = src("app/web/src/strategy.js");
const builderSrc = src("app/web/src/components/Builder.jsx");
const globalStrategy = /localStorage\.setItem\(\s*LEGACY_STRATEGY_KEY/.test(strategySrc)
  || /saveStrategy\(/.test(builderSrc);
const scoped = /watchKey = \(account\)/.test(useVault)
  && /keyFor = \(account\)/.test(src("app/web/src/lib/store.js"))
  && !globalStrategy;
add("10", "multi-user", scoped ? "OK" : "PARTIAL",
  scoped
    ? "sequences, drafts and the working strategy are stored per wallet; no global key remains"
    : "watched sequences are stored under a global browser key, not scoped per wallet",
  scoped ? null : "scope local state by connected account");

const armsAllSteps = /for \(const s of strategy\.steps\)[\s\S]{0,400}armStep\(/.test(builder);
add("2", "chaining", armsAllSteps ? "BLOCKED" : "OK",
  armsAllSteps
    ? "every step is armed up front, so later steps fire on their own markets regardless of the earlier result"
    : "steps advance conditionally",
  armsAllSteps ? "arm only the first step; let the vault arm the next after a real execution" : null);

const executedOnFailure = /st\.status = Status\.EXECUTED;/.test(vaultSol) && !/if \(!ok\)/.test(vaultSol);
add("3", "truthfulness", executedOnFailure ? "BLOCKED" : "OK",
  executedOnFailure
    ? "status is set to EXECUTED even when the pool reports failure, and a filled amount is never checked"
    : "execution status reflects the pool result",
  executedOnFailure ? "only claim EXECUTED on an accepted order; distinguish placed from filled" : null);

const releases = /outstandingNotional -=/.test(vaultSol);
add("4", "risk", releases ? "OK" : "BLOCKED",
  releases ? "exposure is released" : "outstandingNotional only ever increases, so a rolling sequence blocks itself",
  releases ? null : "release exposure when a position settles or is redeemed");

const redeems = /redeem/i.test(vaultSol);
add("5", "capital", redeems ? "OK" : "OPEN",
  redeems ? "redemption exists" : "no redemption path, so won collateral is never recycled",
  redeems ? null : "add redemption once the rolling loop is proven");

const fixedPrice = !/crossingPrice/.test(builder);
add("7", "execution", fixedPrice ? "BLOCKED" : "OK",
  fixedPrice
    ? "successor orders use a fixed limit and never read the book, so an order can fill nothing"
    : "orders are priced to cross the live book, with NO derived from the YES side",
  fixedPrice ? "read the best ask and cross it" : null);

const rechecks = /checkTradable/.test(builder);
add("8", "execution", rechecks ? "OK" : "PARTIAL",
  rechecks
    ? "the successor market is confirmed against the module, including a recycled pool, before anything is signed"
    : "market tradability comes from the indexer, which can lag, and is not rechecked onchain",
  rechecks ? null : "verify the successor is still tradable before arming");

const topUp = /shortfall/.test(goLive);
add("12", "setup", topUp ? "OK" : "BLOCKED",
  topUp ? "setup tops up only the shortfall of the stake" : "setup sends a full 32 SOM even when the vault already holds some");

const factoryAddr = /factory:\s*"(0x[0-9a-fA-F]{40})"/.exec(src("app/web/src/chain/config.js"))?.[1];
add("1b", "multi-user", factoryAddr ? "OK" : "BLOCKED",
  factoryAddr ? `factory deployed at ${factoryAddr}` : "the factory exists in source but is not deployed or wired into the app",
  factoryAddr ? null : "deploy the factory and resolve each wallet's vault through it");

// Installing a package is not integration. This is green only if application
// code actually imports it.
const importsSdk = ["src/chain/markets.js", "src/chain/module.js", "src/chain/vault.js", "src/strategy.js"]
  .some((f) => /@somnia-chain\/markets-sdk/.test(src(`app/web/${f}`)));
add("13", "integration", importsSdk ? "OK" : "OPEN",
  importsSdk
    ? "application code imports the markets SDK"
    : "the app talks to the indexer and contracts directly; the SDK is a dev dependency used to derive and check ABIs, not a runtime integration");

const e2e = src("app/web/scripts/e2e.mjs");
let freshProof = null;
try { freshProof = JSON.parse(src("docs/FRESH_WALLET.json")); } catch { /* none yet */ }
const signedItself = freshProof?.stepStatus === 1
  && freshProof.freshVault?.toLowerCase() !== freshProof.authorVault?.toLowerCase();
add("15", "proof", signedItself ? "OK" : "BLOCKED",
  signedItself
    ? `a new wallet ${freshProof.freshWallet} created its own vault ${freshProof.freshVault} and activated a sequence, signing for itself`
    : "no record of a wallet other than the author completing the journey with real signatures",
  signedItself ? null : "run scripts/fresh-wallet.mjs");

// The recorded live-fire run is the durable proof, so it is read rather than
// asserted.
let fire = null;
try { fire = JSON.parse(src("docs/LIVE_FIRE.json")); } catch { /* none yet */ }
const proven = (fire?.runs || []).find((r) => ["PLACED", "SKIPPED"].includes(r.finalStatus));
add("14", "proof", proven ? "OK" : "BLOCKED",
  proven
    ? `captured on chain: armed -> ${proven.timeline.map((t) => t.event).join(" -> ")} (${proven.outcome})`
    : "no captured run of armed -> settled -> execution or truthful skip",
  proven ? null : "capture the loop end to end");

const reactive = (fire?.runs || []).find((r) =>
  (r.timeline || []).some((t) => t.event === "Triggered")
  && !(r.timeline || []).some((t) => t.event === "ResolutionSynced"));
add("17", "reactivity", reactive ? "OK" : "OPEN",
  reactive
    ? "a settlement reached the vault through Reactivity with no manual sync"
    : "every observed execution needed syncResolution; Reactivity delivering on its own has NOT been observed",
  reactive ? null : "keep Reactivity as the primary path and say plainly that it has not been seen to deliver");

const backstop = /function syncResolution/.test(vaultSol);
add("16", "robustness", backstop ? "OK" : "BLOCKED",
  backstop
    ? "a missed Reactivity delivery can be recovered permissionlessly from onchain market state"
    : "a missed delivery leaves a sequence armed for ever",
  backstop ? null : "add an onchain recovery path");

// ---------------------------------------------------------------- report
const order = { BLOCKED: 0, PARTIAL: 1, CHECK: 2, OPEN: 3, OK: 4 };
rows.sort((a, b) => order[a.state] - order[b.state] || a.area.localeCompare(b.area));

const width = Math.max(...rows.map((r) => r.area.length));
console.log("");
for (const r of rows) {
  console.log(`  ${r.state.padEnd(8)} #${r.id.padEnd(4)} ${r.area.padEnd(width)}  ${r.detail}`);
  if (r.action) console.log(`  ${" ".repeat(8)} ${" ".repeat(5)} ${" ".repeat(width)}  -> ${r.action}`);
}

const blocked = rows.filter((r) => r.state === "BLOCKED").length;
const ok = rows.filter((r) => r.state === "OK").length;
console.log(`\n  ${ok} clear · ${rows.filter((r) => r.state !== "OK" && r.state !== "BLOCKED").length} partial · ${blocked} blocking\n`);
process.exitCode = blocked > 0 ? 1 : 0;
