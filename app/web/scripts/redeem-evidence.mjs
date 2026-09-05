// Proves the last unproven link in the loop: turning a won position back into
// collateral the strategy can spend again.
//
// A rolling sequence that never redeems is not rolling. It converts its bankroll
// into outcome tokens of markets that have already finished, and then starves.
// This drives the whole cycle on Shannon through the product's own path - arm,
// settle, place, settle, redeem - and records the collateral delta.
//
// Winning is not something we can arrange, so a losing attempt is recorded
// honestly and the cycle is retried. Nothing here fakes a position.
//
//   node scripts/redeem-evidence.mjs
//   node scripts/redeem-evidence.mjs --attempts 4
import { createWalletClient, createPublicClient, http, keccak256, toHex, parseEventLogs, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHANNON, shannonChain, txUrl } from "../src/chain/config.js";
import { vaultAbi } from "../src/chain/abi.js";
import { factoryAbi } from "../src/chain/factoryAbi.js";
import { fetchOpenMarkets, fetchBook, crossingPrice, fetchPoolParams, sizeOrder, orderCost } from "../src/chain/markets.js";
import { nextWindowFor } from "../src/strategy.js";
import { marketName } from "../src/lib/language.js";
import { checkTradable } from "../src/chain/module.js";
import { readSettlement, readMarketRecord, readOutcomeBalances } from "../src/chain/positions.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const evidencePath = join(repo, "docs", "REDEMPTION.json");
const env = Object.fromEntries(
  readFileSync(join(repo, ".env"), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const account = privateKeyToAccount(env.PRIVATE_KEY);
const pub = createPublicClient({ chain: shannonChain, transport: http(SHANNON.rpc) });
const wallet = createWalletClient({ account, chain: shannonChain, transport: http(SHANNON.rpc) });

const say = (...a) => console.log(...a);
const usd = (raw) => "$" + (Number(raw) / 1e6).toFixed(4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STATUS = ["NONE", "ARMED", "WAITING", "TRIGGERED", "PLACED", "SKIPPED", "EXPIRED", "CANCELLED", "PENDING"];
const load = () => (existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, "utf8")) : { attempts: [] });
const save = (d) => writeFileSync(evidencePath, JSON.stringify(d, null, 2) + "\n");

const send = async (label, params) => {
  const { request } = await pub.simulateContract({ ...params, account });
  const hash = await wallet.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  say("   " + label + ": " + receipt.status + "  " + txUrl(hash));
  return { hash, receipt };
};

const collateralOf = (vault) => pub.readContract({
  address: SHANNON.testUsdc, abi: erc20Abi, functionName: "balanceOf", args: [vault],
});

async function vaultAddress() {
  const v = await pub.readContract({
    address: SHANNON.factory, abi: factoryAbi, functionName: "vaultFor", args: [account.address],
  });
  if (v === "0x0000000000000000000000000000000000000000") throw new Error("this wallet has no vault");
  return v;
}

// ---- one attempt: buy into a market through the product path ---------------
async function placeIntoAMarket(vault, cap, onArmed) {
  const open = await fetchOpenMarkets(40);
  const now = Math.floor(Date.now() / 1000);
  let trigger = null;
  let successor = null;
  for (const c of open.filter((m) => (m.expiry || 0) - now > 60).sort((a, b) => a.expiry - b.expiry)) {
    const next = nextWindowFor(open, c);
    if (next && (next.expiry || 0) > (c.expiry || 0) + 60) { trigger = c; successor = next; break; }
  }
  if (!trigger) throw new Error("no market pair is far enough out to arm safely");

  const check = await checkTradable(successor.marketId, successor.pool);
  if (!check.ok) throw new Error("successor not tradable: " + check.problems.join("; "));

  const book = await fetchBook(successor.marketId);
  const price0 = crossingPrice(book, false) ?? 500000n;
  const params = await fetchPoolParams(successor.pool, pub);
  const sized = sizeOrder({ price: price0, budget: cap, ...params });
  if (!sized) throw new Error("one minimum lot costs more than " + usd(cap));
  const { price, quantity } = sized;

  say("   watching  " + marketName(trigger) + "  settles in " + (trigger.expiry - now) + "s");
  say("   buys into " + marketName(successor));
  say("   order     " + quantity + " @ " + usd(price) + " = " + usd(orderCost(price, quantity)));

  await send("approvePool", { address: vault, abi: vaultAbi, functionName: "approvePool", args: [successor.pool, cap * 4n] });

  const stepId = keccak256(toHex("redeem-" + trigger.marketId + "-" + Date.now()));
  // Recorded before the wait: an armed step is real chain state, and losing the
  // id to a dropped connection would leave a live position we cannot find again.
  onArmed({ stepId, trigger, successor });
  await send("armStep", { address: vault, abi: vaultAbi, functionName: "armStep", args: [stepId, {
    status: 0, triggerMarketId: trigger.marketId, pool: successor.pool, price, quantity,
    expireNs: BigInt(successor.expiry) * 1000000000n, orderType: 2,
    actionOnWin0: 0, actionOnWin1: 2, notionalCap: cap,
    successorMarketId: successor.marketId, nextStepId: "0x" + "00".repeat(32),
    orderId: 0n, winningOutcome: 0,
  }] });

  // Wait for the trigger to settle, then let Reactivity have its chance before
  // falling back to the permissionless sync.
  const deadline = Date.now() + 25 * 60 * 1000;
  let synced = false;
  while (Date.now() < deadline) {
    // Read through a retry: the public RPC drops requests, and treating a failed
    // read as ARMED once cost us a whole run that had in fact already placed.
    let raw = null;
    for (let t = 0; t < 3 && raw === null; t++) {
      try {
        raw = await pub.readContract({ address: vault, abi: vaultAbi, functionName: "stepStatus", args: [stepId] });
      } catch { await sleep(5000); }
    }
    if (raw === null) { say("   RPC unreachable; retrying"); await sleep(20000); continue; }
    const status = STATUS[Number(raw)];
    if (["PLACED", "SKIPPED", "EXPIRED", "CANCELLED"].includes(status)) {
      say("   step " + status + (synced ? " (via syncResolution)" : " (via Reactivity)"));
      return { stepId, trigger, successor, status, synced };
    }
    const past = Math.floor(Date.now() / 1000) - trigger.expiry;
    if (!synced && past > 45) {
      try {
        await send("syncResolution", { address: vault, abi: vaultAbi, functionName: "syncResolution", args: [trigger.marketId] });
        synced = true;
      } catch { /* not resolved yet */ }
    }
    say("   " + status + "  (" + (past < 0 ? -past + "s to settlement" : past + "s past") + ")");
    await sleep(20000);
  }
  throw new Error("the trigger never settled inside the window");
}

// ---- wait for the market we bought into to finalize ------------------------
async function waitForSettlement(marketId) {
  const record = await readMarketRecord(marketId);
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    const s = await readSettlement(record.yesId);
    if (s.finalized) return { record, settlement: s };
    say("   waiting for " + marketId.slice(0, 12) + " to finalize");
    await sleep(30000);
  }
  throw new Error("the market we bought into never finalized");
}

// ---- the cycle -------------------------------------------------------------
const maxAttempts = Number(process.argv[process.argv.indexOf("--attempts") + 1]) || 3;
const cap = 2000000n;
const vault = await vaultAddress();
say("owner " + account.address);
say("vault " + vault);

const all = load();
let proven = null;

for (let i = 1; i <= maxAttempts && !proven; i++) {
  say("\n--- attempt " + i + " of " + maxAttempts + " ---");
  const attempt = { attempt: i, vault, startedAt: new Date().toISOString() };
  try {
    const placed = await placeIntoAMarket(vault, cap, ({ stepId, trigger, successor }) => {
      attempt.stepId = stepId;
      attempt.trigger = { marketId: trigger.marketId, name: marketName(trigger) };
      attempt.boughtInto = { marketId: successor.marketId, name: marketName(successor) };
      all.attempts.push(attempt); save(all);
    });
    all.attempts.pop();
    attempt.stepId = placed.stepId;
    attempt.stepStatus = placed.status;
    attempt.advancedBy = placed.synced ? "syncResolution" : "reactivity";
    attempt.trigger = { marketId: placed.trigger.marketId, name: marketName(placed.trigger) };
    attempt.boughtInto = { marketId: placed.successor.marketId, name: marketName(placed.successor) };

    if (placed.status !== "PLACED") {
      attempt.result = "no position taken: step ended " + placed.status;
      say("   " + attempt.result);
      all.attempts.push(attempt); save(all); continue;
    }

    say("\n   waiting for " + marketName(placed.successor) + " to settle");
    const { record, settlement } = await waitForSettlement(placed.successor.marketId);
    const balances = await readOutcomeBalances(vault, { ...record, outcomeToken: settlement.outcomeToken });
    const claimable = settlement.voided ? balances.yes + balances.no
      : settlement.winner === 0 ? balances.yes
      : settlement.winner === 1 ? balances.no : 0n;

    attempt.settlement = {
      finalized: settlement.finalized, voided: settlement.voided,
      winner: settlement.winner, payouts: settlement.payouts.map(String),
      heldYes: balances.yes.toString(), heldNo: balances.no.toString(),
      claimable: claimable.toString(),
    };
    say("   settled: winner outcome " + settlement.winner + ", held YES " + balances.yes + " NO " + balances.no);

    if (claimable === 0n) {
      attempt.result = "the side we bought lost; nothing to redeem. Retrying.";
      say("   " + attempt.result);
      all.attempts.push(attempt); save(all); continue;
    }

    const before = await collateralOf(vault);
    say("\n   redeeming " + claimable + " outcome tokens");
    const { hash, receipt } = await send("redeemPosition", {
      address: vault, abi: vaultAbi, functionName: "redeemPosition", args: [placed.successor.marketId],
    });
    const after = await collateralOf(vault);
    const post = await readOutcomeBalances(vault, { ...record, outcomeToken: settlement.outcomeToken });
    const events = parseEventLogs({ abi: vaultAbi, logs: receipt.logs })
      .filter((e) => e.eventName === "Redeemed")
      .map((e) => Object.fromEntries(Object.entries(e.args).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])));

    attempt.redemption = {
      txHash: hash, explorer: txUrl(hash), blockNumber: receipt.blockNumber.toString(),
      collateralBefore: before.toString(), collateralAfter: after.toString(),
      collateralGained: (after - before).toString(),
      outcomeBalanceAfter: { yes: post.yes.toString(), no: post.no.toString() },
      redeemedEvents: events,
    };
    attempt.result = "redeemed";
    say("   collateral " + usd(before) + " -> " + usd(after) + "  (+" + usd(after - before) + ")");
    say("   position after redemption: YES " + post.yes + " NO " + post.no);
    all.attempts.push(attempt); save(all);
    proven = attempt;
  } catch (e) {
    attempt.result = "failed: " + e.message;
    say("   " + attempt.result);
    all.attempts.push(attempt); save(all);
  }
}

// A failed search must never overwrite a proof that already exists: the file is
// read by the readiness gate, and a contradictory machine-readable state is
// worse than no state at all.
const standing = all.proof && BigInt(all.proof.collateralGained || "0") > 0n;
all.summary = proven
  ? {
      proven: true,
      note: "A position taken through the product's own path was redeemed back into collateral on Shannon.",
      vault, marketId: proven.boughtInto.marketId,
      collateralGained: proven.redemption.collateralGained,
      txHash: proven.redemption.txHash,
      attemptsNeeded: proven.attempt,
    }
  : standing
    ? { ...all.summary, proven: true, note: all.proof.note, txHash: all.proof.txHash,
        collateralGained: all.proof.collateralGained,
        lastSearch: `no new winning position after ${maxAttempts} attempts; the standing proof is unaffected` }
    : { proven: false, note: `No winning position after ${maxAttempts} attempts. Every attempt is recorded above.` };
save(all);
say("\n" + (proven ? "PROVEN" : "NOT PROVEN") + " - written to docs/REDEMPTION.json");
process.exit(proven ? 0 : 1);
