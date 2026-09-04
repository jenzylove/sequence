// Live fire: arm one real sequence on a real DreamDEX market, wait for that
// market to actually settle, and record what the vault did about it.
//
// This is the proof the whole product rests on. It signs with the owner key from
// .env and writes an evidence file that can be read back later, so the result is
// a record rather than a memory.
//
//   node scripts/live-fire.mjs          # arm, then watch to settlement
//   node scripts/live-fire.mjs --watch  # watch an already-armed run
import { createWalletClient, createPublicClient, http, keccak256, toHex, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHANNON, shannonChain, txUrl } from "../src/chain/config.js";
import { vaultAbi } from "../src/chain/abi.js";
import { factoryAbi } from "../src/chain/factoryAbi.js";
import { fetchOpenMarkets, fetchBook, crossingPrice } from "../src/chain/markets.js";
import { nextWindowFor } from "../src/strategy.js";
import { marketName } from "../src/lib/language.js";
import { checkTradable } from "../src/chain/module.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const evidenceDir = join(repo, "docs");
const evidencePath = join(evidenceDir, "LIVE_FIRE.json");
if (!existsSync(evidenceDir)) mkdirSync(evidenceDir, { recursive: true });

const env = Object.fromEntries(
  readFileSync(join(repo, ".env"), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
if (!env.PRIVATE_KEY) throw new Error("PRIVATE_KEY missing from .env");

const account = privateKeyToAccount(env.PRIVATE_KEY);
const pub = createPublicClient({ chain: shannonChain, transport: http(SHANNON.rpc) });
const wallet = createWalletClient({ account, chain: shannonChain, transport: http(SHANNON.rpc) });
const say = (...a) => console.log(...a);
const usd = (raw) => `$${(Number(raw) / 1e6).toFixed(3)}`;

const send = async (label, params) => {
  const { request } = await pub.simulateContract({ ...params, account });
  const hash = await wallet.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  say(`   ${label}: ${receipt.status} ${txUrl(hash)}`);
  return { hash, receipt };
};

const load = () => {
  if (!existsSync(evidencePath)) return { runs: [] };
  const raw = JSON.parse(readFileSync(evidencePath, "utf8"));
  // Earlier evidence held a single run at the top level.
  return raw.runs ? raw : { runs: [raw] };
};
const save = (data) => writeFileSync(evidencePath, JSON.stringify(data, null, 2) + "\n");

// ---------------------------------------------------------------- arm
async function arm() {
  const vault = await pub.readContract({
    address: SHANNON.factory, abi: factoryAbi, functionName: "vaultFor", args: [account.address],
  });
  if (vault === "0x0000000000000000000000000000000000000000") throw new Error("this wallet has no vault");
  say(`owner ${account.address}\nvault ${vault}\n`);

  const open = await fetchOpenMarkets(40);
  const now = Math.floor(Date.now() / 1000);

  // The trigger must still be at least a minute away, and its successor must
  // outlive it, or the order would be placed into a closed market.
  let trigger = null; let successor = null;
  for (const candidate of open.filter((m) => (m.expiry || 0) - now > 60).sort((a, b) => a.expiry - b.expiry)) {
    const next = nextWindowFor(open, candidate);
    if (next && (next.expiry || 0) > (candidate.expiry || 0) + 60) { trigger = candidate; successor = next; break; }
  }
  if (!trigger) throw new Error("no market pair is far enough out to arm safely");

  const check = await checkTradable(successor.marketId, successor.pool);
  if (!check.ok) throw new Error(`successor not tradable: ${check.problems.join("; ")}`);

  const book = await fetchBook(successor.marketId);
  const price = crossingPrice(book, false) ?? 500000n; // buying YES on outcome 0
  const cap = 2000000n;                                 // $2, inside the $5 account limit
  let quantity = cap / price;
  if (quantity < 1n) quantity = 1n;
  const notional = price * quantity;

  say(`watching   ${marketName(trigger)}  settles in ${trigger.expiry - now}s`);
  say(`trades into ${marketName(successor)}  pool ${successor.pool}`);
  say(`book        bestAskYes ${usd(book.bestAskYes)} depth ${book.depth}`);
  say(`order       ${quantity} @ ${usd(price)} = ${usd(notional)} (cap ${usd(cap)})\n`);

  say("1. approving the pool to draw collateral");
  await send("approvePool", {
    address: vault, abi: vaultAbi, functionName: "approvePool", args: [successor.pool, cap * 4n],
  });

  const stepId = keccak256(toHex(`live-fire-${trigger.marketId}-${Date.now()}`));
  const step = {
    status: 0,
    triggerMarketId: trigger.marketId,
    pool: successor.pool,
    price, quantity,
    expireNs: BigInt(successor.expiry) * 1_000_000_000n,
    orderType: 2,                       // fill what you can
    actionOnWin0: 0,                    // YES wins -> buy YES
    actionOnWin1: 2,                    // NO wins  -> buy NO
    notionalCap: cap,
    successorMarketId: successor.marketId,
    nextStepId: `0x${"00".repeat(32)}`,
    orderId: 0n,
    winningOutcome: 0,
  };

  say("2. arming the step");
  const armed = await send("armStep", { address: vault, abi: vaultAbi, functionName: "armStep", args: [stepId, step] });

  const evidence = {
    note: "Live fire: one real DreamDEX settlement driving one real Sequence action.",
    owner: account.address,
    vault,
    factory: SHANNON.factory,
    subscriptionId: (await pub.readContract({ address: vault, abi: vaultAbi, functionName: "subscriptionId" })).toString(),
    stepId,
    trigger: { marketId: trigger.marketId, name: marketName(trigger), expiry: trigger.expiry, question: trigger.question },
    successor: { marketId: successor.marketId, name: marketName(successor), pool: successor.pool, expiry: successor.expiry },
    order: { price: price.toString(), quantity: quantity.toString(), notional: notional.toString(), cap: cap.toString() },
    armedAt: new Date().toISOString(),
    armedTx: armed.hash,
    armedBlock: armed.receipt.blockNumber.toString(),
    timeline: [],
    outcome: "waiting",
  };
  // Append rather than overwrite: a stalled venue must not cost us the record
  // of what was already attempted.
  const all = load();
  all.runs.push(evidence);
  save(all);
  say(`\nevidence written to docs/LIVE_FIRE.json (run ${all.runs.length})`);
  return all;
}

// ---------------------------------------------------------------- watch
async function watch(all) {
  const runs = all.runs.filter((r) => !["PLACED", "SKIPPED", "EXPIRED", "CANCELLED"].includes(r.finalStatus));
  if (runs.length === 0) { say("every recorded run has already reached a final state"); return all; }
  const vault = runs[0].vault;
  const STATUS = ["NONE", "ARMED", "WAITING", "TRIGGERED", "PLACED", "SKIPPED", "EXPIRED", "CANCELLED", "PENDING"];

  say(`\nwatching ${runs.length} armed run(s) on ${vault}`);
  for (const r of runs) say(`   ${r.trigger.name} expired/expires ${new Date(r.trigger.expiry * 1000).toISOString()}`);

  let from = runs.map((r) => BigInt(r.armedBlock)).reduce((a, b) => (a < b ? a : b));
  const deadline = Date.now() + 90 * 60 * 1000;
  const seen = new Set(all.runs.flatMap((r) => (r.timeline || []).map((t) => `${t.txHash}:${t.logIndex}`)));

  while (Date.now() < deadline) {
    const latest = await pub.getBlockNumber();
    for (let start = from; start <= latest; start += 1000n) {
      const to = start + 999n > latest ? latest : start + 999n;
      let logs = [];
      try { logs = await pub.getLogs({ address: vault, fromBlock: start, toBlock: to }); } catch { continue; }
      for (const log of parseEventLogs({ abi: vaultAbi, logs })) {
        const key = `${log.transactionHash}:${log.logIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const args = Object.fromEntries(Object.entries(log.args || {}).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));
        const entry = { event: log.eventName, args, blockNumber: log.blockNumber.toString(), txHash: log.transactionHash, logIndex: log.logIndex, at: new Date().toISOString() };
        const run = all.runs.find((r) => r.stepId === args.stepId) || runs[0];
        (run.timeline ||= []).push(entry);
        say(`   ${entry.event}  ${JSON.stringify(args).slice(0, 140)}  ${txUrl(entry.txHash)}`);
        if (entry.event === "Placed") run.outcome = "placed";
        if (entry.event === "Skipped") run.outcome = `skipped: ${args.reason}`;
        if (entry.event === "PlacementRejected") run.outcome = "order rejected by the pool";
        save(all);
      }
    }
    from = latest + 1n;

    let settled = false;
    for (const r of runs) {
      const status = await pub.readContract({ address: vault, abi: vaultAbi, functionName: "stepStatus", args: [r.stepId] });
      r.finalStatus = STATUS[Number(status)];
      if (["PLACED", "SKIPPED", "EXPIRED", "CANCELLED"].includes(r.finalStatus)) {
        r.settledAt = new Date().toISOString();
        settled = true;
      }
    }
    save(all);
    if (settled) {
      say(`
reached a final state:`);
      for (const r of runs) say(`   ${r.trigger.name}: ${r.finalStatus} (${r.outcome})`);
      return all;
    }

    say(`   ${runs.map((r) => `${r.trigger.name}:${r.finalStatus}`).join("  ")}`);
    await new Promise((res) => setTimeout(res, 30000));
  }
  for (const r of runs) if (r.outcome === "waiting") r.outcome = "timed out waiting for settlement";
  save(all);
  return all;
}

const watchOnly = process.argv.includes("--watch");
const evidence = watchOnly ? load() : await arm();
await watch(evidence);
process.exit(0);
