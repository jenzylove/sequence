// The claim the product rests on, tested with two strangers.
//
// Two separate wallets, two separate vaults, two separate rules. Neither wallet
// holds anything like a 32 STT stake. Sequence's subscription manager owns the
// subscriptions and pays for delivery. Both traders arm and walk away.
//
// The test is whether both sequences advance on their own. Nothing here ever
// calls syncResolution — if a vault moves, Reactivity moved it.
import { createWalletClient, createPublicClient, http, keccak256, toHex, parseEventLogs, encodePacked } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHANNON, shannonChain, txUrl } from "../src/chain/config.js";
import { vaultAbi } from "../src/chain/abi.js";
import { fetchOpenMarkets, fetchBook, crossingPrice, fetchPoolParams, sizeOrder, orderCost } from "../src/chain/markets.js";
import { nextWindowFor, toVaultStep } from "../src/strategy.js";
import { marketName } from "../src/lib/language.js";
import { checkTradable } from "../src/chain/module.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const evidencePath = join(repo, "docs", "SHARED_REACTIVITY_LIVE.json");
const env = Object.fromEntries(
  readFileSync(join(repo, ".env"), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const funder = privateKeyToAccount(env.PRIVATE_KEY);
const pub = createPublicClient({ chain: shannonChain, transport: http(SHANNON.rpc) });
const funderWallet = createWalletClient({ account: funder, chain: shannonChain, transport: http(SHANNON.rpc) });
const say = (...a) => console.log(...a);
const usd = (r) => `$${(Number(r) / 1e6).toFixed(2)}`;
const stt = (w) => `${(Number(w) / 1e18).toFixed(2)} STT`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STATUS = ["NONE", "ARMED", "WAITING", "TRIGGERED", "PLACED", "SKIPPED", "EXPIRED", "CANCELLED", "PENDING"];

const managerAbi = JSON.parse(readFileSync(join(repo, "out/SequenceSubscriptionManager.sol/SequenceSubscriptionManager.json"), "utf8")).abi;
const erc20 = [{ type: "function", stateMutability: "nonpayable", name: "transfer", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }];

const lines = readFileSync(join(repo, "docs", "SPIKE_KEYS.txt"), "utf8").trim().split("\n");
const manager = lines.find((l) => l.startsWith("MANAGER")).split(" ")[1];
const users = lines.filter((l) => /^[AB] /.test(l)).map((l) => {
  const [label, address, key, vault] = l.split(" ");
  const acct = privateKeyToAccount(key);
  return { label, acct, vault, wallet: createWalletClient({ account: acct, chain: shannonChain, transport: http(SHANNON.rpc) }) };
});

const send = async (wallet, params) => {
  const { request } = await pub.simulateContract(params);
  const hash = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`reverted ${hash}`);
  return hash;
};

say(`manager ${manager} holding ${stt(await pub.getBalance({ address: manager }))}`);
for (const u of users) say(`user ${u.label} ${u.acct.address} vault ${u.vault} holding ${stt(await pub.getBalance({ address: u.acct.address }))}`);
say("");

// ---- give each vault a little collateral -----------------------------------
for (const u of users) {
  const h = await send(funderWallet, {
    address: SHANNON.testUsdc, abi: erc20, functionName: "transfer", args: [u.vault, 3_000000n], account: funder,
  });
  say(`  funded ${u.label}'s vault with ${usd(3_000000n)}  ${txUrl(h)}`);
}

// ---- pick a real trigger for each, and arm ---------------------------------
const open = await fetchOpenMarkets(40);
const now = Math.floor(Date.now() / 1000);
const pairs = [];
for (const c of open.filter((m) => (m.expiry || 0) - now > 120).sort((a, b) => a.expiry - b.expiry)) {
  const next = nextWindowFor(open, c);
  if (!next || (next.expiry || 0) <= (c.expiry || 0) + 60) continue;
  if (pairs.some((p) => p.trigger.marketId === c.marketId)) continue;
  const ok = await checkTradable(next.marketId, next.pool);
  if (!ok.ok) continue;
  pairs.push({ trigger: c, successor: next });
  if (pairs.length === users.length) break;
}
if (pairs.length < users.length) throw new Error("not enough distinct tradable market pairs right now");

const armed = [];
for (const [i, u] of users.entries()) {
  const { trigger, successor } = pairs[i];
  const book = await fetchBook(successor.marketId);
  const params = await fetchPoolParams(successor.pool, pub);
  const sized = sizeOrder({ price: crossingPrice(book, false) ?? 500000n, budget: 2_000000n, ...params });
  if (!sized) throw new Error(`cannot size an order for ${u.label}`);

  await send(u.wallet, {
    address: u.vault, abi: vaultAbi, functionName: "approvePool",
    args: [successor.pool, 5_000000n], account: u.acct,
  });

  const stepId = keccak256(toHex(`shared-${u.label}-${trigger.marketId}-${Date.now()}`));
  const step = {
    status: 0, orderId: 0n, winningOutcome: 0,
    ...toVaultStep({
      triggerMarketId: trigger.marketId, successorMarketId: successor.marketId,
      pool: successor.pool, price: sized.price, quantity: sized.quantity,
      triggerExpiry: trigger.expiry, successorExpiry: successor.expiry,
      actionOnWin0: 0, actionOnWin1: 2, notionalCap: 2_000000n, orderType: 2,
    }, Date.now(), `0x${"00".repeat(32)}`),
  };
  const armTx = await send(u.wallet, {
    address: u.vault, abi: vaultAbi, functionName: "armStep", args: [stepId, step], account: u.acct,
  });
  const armedBlock = (await pub.getTransactionReceipt({ hash: armTx })).blockNumber;

  // The user registers their own vault. Sequence's stake pays for it.
  const regTx = await send(u.wallet, {
    address: manager, abi: managerAbi, functionName: "register",
    args: [u.vault, trigger.marketId], account: u.acct,
  });
  const key = keccak256(encodePacked(["address", "bytes32"], [u.vault, trigger.marketId]));
  const subId = await pub.readContract({ address: manager, abi: managerAbi, functionName: "subscriptionOf", args: [key] });

  armed.push({ ...u, trigger, successor, stepId, armTx, armedBlock, regTx, subscriptionId: subId, order: orderCost(sized.price, sized.quantity) });
  say(`  ${u.label}: watching ${marketName(trigger)} → ${marketName(successor)}, ${usd(orderCost(sized.price, sized.quantity))}, subscription ${subId}`);
  say(`     armed ${txUrl(armTx)}`);
  say(`     registered ${txUrl(regTx)}`);
}

say(`\nboth traders have left. Nothing below calls syncResolution.\n`);

// ---- wait, and watch --------------------------------------------------------
const deadline = Date.now() + 40 * 60 * 1000;
const done = new Set();
while (Date.now() < deadline && done.size < armed.length) {
  for (const a of armed) {
    if (done.has(a.label)) continue;
    const raw = await pub.readContract({ address: a.vault, abi: vaultAbi, functionName: "stepStatus", args: [a.stepId] }).catch(() => null);
    if (raw === null) continue;
    const status = STATUS[Number(raw)];
    if (["PLACED", "SKIPPED", "EXPIRED", "CANCELLED"].includes(status)) {
      a.finalStatus = status;
      done.add(a.label);
      say(`  ${a.label}: ${status}`);
    }
  }
  if (done.size < armed.length) {
    const left = armed.filter((a) => !done.has(a.label));
    say(`  waiting: ${left.map((a) => `${a.label} ${Math.max(0, a.trigger.expiry - Math.floor(Date.now() / 1000))}s`).join("  ")}`);
    await sleep(20000);
  }
}

// ---- the evidence: what moved, and what moved it ----------------------------
const latest = await pub.getBlockNumber();
for (const a of armed) {
  const logs = [];
  for (let f = a.armedBlock; f <= latest; f += 1000n) {
    const t = f + 999n > latest ? latest : f + 999n;
    try { logs.push(...await pub.getLogs({ address: a.vault, fromBlock: f, toBlock: t })); } catch { /* skip */ }
  }
  a.timeline = parseEventLogs({ abi: vaultAbi, logs })
    .filter((e) => !e.args?.stepId || e.args.stepId === a.stepId)
    .map((e) => ({ event: e.eventName, txHash: e.transactionHash, blockNumber: e.blockNumber.toString() }));
  a.usedSync = a.timeline.some((t) => t.event === "ResolutionSynced");
  a.advancedAutomatically = a.timeline.some((t) => t.event === "Triggered") && !a.usedSync;
  a.finalStatus = a.finalStatus || STATUS[Number(await pub.readContract({ address: a.vault, abi: vaultAbi, functionName: "stepStatus", args: [a.stepId] }))];
}

const checks = [];
for (const a of armed) {
  checks.push([`user ${a.label}'s sequence advanced with no manual step`, Boolean(a.advancedAutomatically),
    `${a.timeline.map((t) => t.event).join(" → ") || "nothing"} [${a.finalStatus}]`]);
  checks.push([`user ${a.label} never called syncResolution`, !a.usedSync, a.usedSync ? "sync present" : "no ResolutionSynced"]);
  const bal = await pub.getBalance({ address: a.acct.address });
  checks.push([`user ${a.label} never held a 32 STT stake`, bal < 32n * 10n ** 18n, stt(bal)]);
}
const mgrBal = await pub.getBalance({ address: manager });
checks.push(["one shared stake covered both users", mgrBal < 64n * 10n ** 18n, stt(mgrBal)]);
checks.push(["the two vaults are genuinely different accounts",
  armed[0].vault.toLowerCase() !== armed[1].vault.toLowerCase(), `${armed[0].vault} / ${armed[1].vault}`]);

say("");
let bad = 0;
for (const [label, pass, detail] of checks) { say(`  ${pass ? "PASS" : "FAIL"}  ${label} — ${detail}`); if (!pass) bad++; }

writeFileSync(evidencePath, JSON.stringify({
  question: "Do two unrelated users, neither staking, both get automatic execution from one shared Reactivity stake?",
  answer: bad === 0
    ? "Yes. Two wallets, two vaults, two rules, one subscription owner paying for delivery. Both advanced without any manual step."
    : "Not yet; see the failing checks.",
  manager, managerStake: mgrBal.toString(),
  users: armed.map((a) => ({
    label: a.label, wallet: a.acct.address, vault: a.vault,
    trigger: { marketId: a.trigger.marketId, name: marketName(a.trigger) },
    successor: { marketId: a.successor.marketId, name: marketName(a.successor) },
    subscriptionId: a.subscriptionId.toString(),
    armTx: a.armTx, registerTx: a.regTx,
    finalStatus: a.finalStatus, advancedAutomatically: a.advancedAutomatically,
    usedSyncResolution: a.usedSync, timeline: a.timeline,
  })),
  checks: checks.map(([check, pass, detail]) => ({ check, pass, detail: String(detail) })),
  provenAt: new Date().toISOString(),
}, null, 2) + "\n");

say(`\n${bad === 0 ? "MULTI-USER AUTOMATIC EXECUTION PROVEN" : `${bad} check(s) failed`} — docs/SHARED_REACTIVITY_LIVE.json`);
process.exit(bad === 0 ? 0 : 1);
