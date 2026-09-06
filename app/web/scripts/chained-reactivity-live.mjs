// Final thesis proof: one registration, two dependent settlements, no user present.
//
// This creates a fresh trader/vault, arms A -> B, queues B -> C, and calls the
// shared manager ONCE. The hardened manager must create exact subscriptions for
// both A and B up front. Sequence then waits. A settlement must place step 1 and
// arm step 2; B settlement must place step 2. Nothing in this file ever calls
// syncResolution.
import {
  createWalletClient, createPublicClient, http, keccak256, toHex,
  parseEventLogs, encodePacked,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHANNON, shannonChain, txUrl } from "../src/chain/config.js";
import { factoryAbi } from "../src/chain/factoryAbi.js";
import { vaultAbi } from "../src/chain/abi.js";
import {
  fetchOpenMarkets, fetchBook, crossingPrice, fetchPoolParams, sizeOrder, orderCost,
} from "../src/chain/markets.js";
import { nextWindowFor, toVaultStep } from "../src/strategy.js";
import { marketName } from "../src/lib/language.js";
import { checkTradable } from "../src/chain/module.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const env = Object.fromEntries(
  readFileSync(join(repo, ".env"), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
if (!/^0x[0-9a-fA-F]{64}$/.test(env.PRIVATE_KEY || "")) throw new Error("PRIVATE_KEY missing/invalid in .env");
const deploymentPath = join(repo, "docs", "SHARED_MANAGER_DEPLOYMENT.json");
if (!existsSync(deploymentPath)) throw new Error("run deploy-shared-manager.mjs first; deployment evidence is missing");
const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
const manager = deployment.manager;
if (!/^0x[0-9a-fA-F]{40}$/.test(manager || "")) throw new Error("deployment evidence has no manager address");

const funder = privateKeyToAccount(env.PRIVATE_KEY);
const rpc = env.RPC_URL || SHANNON.rpc;
const pub = createPublicClient({ chain: shannonChain, transport: http(rpc) });
const funderWallet = createWalletClient({ account: funder, chain: shannonChain, transport: http(rpc) });
const managerAbi = JSON.parse(readFileSync(join(repo, "out/SequenceSubscriptionManager.sol/SequenceSubscriptionManager.json"), "utf8")).abi;
const erc20 = [{ type: "function", stateMutability: "nonpayable", name: "transfer", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }];
const STATUS = ["NONE", "ARMED", "WAITING", "TRIGGERED", "PLACED", "SKIPPED", "EXPIRED", "CANCELLED", "PENDING"];
const ZERO32 = `0x${"00".repeat(32)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usd = (x) => `$${(Number(x) / 1e6).toFixed(2)}`;
const stt = (x) => `${(Number(x) / 1e18).toFixed(2)} STT`;

const send = async (wallet, params) => {
  const { request } = await pub.simulateContract(params);
  const hash = await wallet.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`reverted ${hash}`);
  return { hash, receipt };
};

const managerCode = await pub.getBytecode({ address: manager });
if (!managerCode || managerCode === "0x") throw new Error(`new manager has no code: ${manager}`);
const managerFactory = await pub.readContract({ address: manager, abi: managerAbi, functionName: "factory" });
if (managerFactory.toLowerCase() !== SHANNON.factory.toLowerCase()) {
  throw new Error(`manager is bound to ${managerFactory}, expected ${SHANNON.factory}`);
}

// ---- fresh user -------------------------------------------------------------
const userKey = generatePrivateKey();
const user = privateKeyToAccount(userKey);
const userWallet = createWalletClient({ account: user, chain: shannonChain, transport: http(rpc) });
writeFileSync(join(repo, "docs", "CHAIN_PROOF_KEY.txt"), `${user.address} ${userKey}\n`);

const gasSeed = await funderWallet.sendTransaction({ to: user.address, value: 4n * 10n ** 18n });
await pub.waitForTransactionReceipt({ hash: gasSeed });
const created = await send(userWallet, {
  address: SHANNON.factory, abi: factoryAbi, functionName: "createVault",
  args: [5_000000n], account: user,
});
const vault = await pub.readContract({
  address: SHANNON.factory, abi: factoryAbi, functionName: "vaultFor", args: [user.address],
});
const funded = await send(funderWallet, {
  address: SHANNON.testUsdc, abi: erc20, functionName: "transfer", args: [vault, 5_000000n], account: funder,
});
console.log(`fresh trader ${user.address} (${stt(await pub.getBalance({ address: user.address }))})`);
console.log(`vault ${vault}, funded ${usd(5_000000n)}`);

// ---- which cadences does the oracle actually deliver for? ------------------
//
// Reactivity fires on OracleHub's AnswerDelivered. Not every market produces
// one: watching the hub for several hours, only the longer windows do, while the
// one- and five-minute contracts finalize through another path and emit nothing
// the subscription could match. A chain built on those can never advance
// automatically no matter how correct the plumbing is, so this reads the hub
// first and only builds the proof on cadences it can actually see.
async function deliverableCadences() {
  const { parseAbiItem } = await import("viem");
  const AD = parseAbiItem(
    "event AnswerDelivered(uint256 indexed questionId, bytes32 indexed marketId, uint32 adapterId, uint256[] payoutNumerators, bool isVoid)",
  );
  const ORACLE_HUB = "0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b";
  const latest = await pub.getBlockNumber();
  const seen = [];
  for (let back = 0n; back < 200000n && seen.length < 40; back += 1000n) {
    const to = latest - back;
    try {
      seen.push(...await pub.getLogs({ address: ORACLE_HUB, event: AD, fromBlock: to - 999n, toBlock: to }));
    } catch { /* window unavailable */ }
  }
  const ids = [...new Set(seen.map((l) => l.topics[2]))];
  if (!ids.length) return null;
  const res = await fetch(SHANNON.indexer, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: "query($ids:[String!]){ Market(where:{marketId:{_in:$ids}}){ intervalSec } }",
      variables: { ids },
    }),
  }).then((r) => r.json()).catch(() => null);
  const cadences = new Set((res?.data?.Market ?? []).map((m) => Number(m.intervalSec)).filter(Boolean));
  return cadences.size ? cadences : null;
}

const deliverable = await deliverableCadences();
console.log(`oracle delivers for cadences: ${deliverable ? [...deliverable].sort((x, y) => x - y).join("s, ") + "s" : "unknown (proceeding without the filter)"}`);

// ---- find A -> B -> C, preferring the shortest real proof ------------------
const open = await fetchOpenMarkets(100);
const now = Math.floor(Date.now() / 1000);
const candidates = [];
for (const a of open.filter((m) => m.pool && (m.expiry || 0) - now > 90)) {
  const b = nextWindowFor(open, a);
  if (!b) continue;
  const c = nextWindowFor(open, b);
  if (!c) continue;
  if (a.asset !== b.asset || b.asset !== c.asset) continue;
  // A and B are the two markets whose settlement must wake the vault, so both
  // have to be cadences the oracle actually answers. C is only ever traded into.
  if (deliverable && (!deliverable.has(Number(a.intervalSec)) || !deliverable.has(Number(b.intervalSec)))) continue;
  // Both successors have to be places an order can actually land. Tradable is not
  // the same as liquid: the previous run traded step 2 into a 45-day contract
  // whose book could not absorb the order 76 minutes after it was priced, and
  // the vault correctly recorded that as skipped rather than claiming a fill.
  //
  // Note that C cannot be required to share B's cadence: only one window per
  // series is open at a time, so a rolling chain necessarily steps across
  // cadences. Liquidity is the real requirement, not sameness.
  const [bBook, cBook] = await Promise.all([fetchBook(b.marketId), fetchBook(c.marketId)]);
  if (!bBook?.depth || crossingPrice(bBook, false) == null) continue;
  if (!cBook?.depth || crossingPrice(cBook, false) == null) continue;
  const [bOk, cOk] = await Promise.all([checkTradable(b.marketId, b.pool), checkTradable(c.marketId, c.pool)]);
  if (!bOk.ok || !cOk.ok) continue;
  candidates.push({ a, b, c });
}
if (!candidates.length) throw new Error("no real three-market chain is currently available");
candidates.sort((x, y) => (x.b.expiry || Infinity) - (y.b.expiry || Infinity));
const { a, b, c } = candidates[0];
console.log(`chain: ${marketName(a)} -> ${marketName(b)} -> ${marketName(c)}`);
console.log(`A settles in ${Math.max(0, a.expiry - now)}s; B settles in ${Math.max(0, b.expiry - now)}s`);

const makeSized = async (market, budget = 1_000000n) => {
  const [book, params] = await Promise.all([fetchBook(market.marketId), fetchPoolParams(market.pool, pub)]);
  const px = crossingPrice(book, false) ?? 500000n;
  const sized = sizeOrder({ price: px, budget, ...params });
  if (!sized) throw new Error(`cannot size ${marketName(market)} at ${px}`);
  return sized;
};
const [size1, size2] = await Promise.all([makeSized(b), makeSized(c)]);

await send(userWallet, { address: vault, abi: vaultAbi, functionName: "approvePool", args: [b.pool, 3_000000n], account: user });
await send(userWallet, { address: vault, abi: vaultAbi, functionName: "approvePool", args: [c.pool, 3_000000n], account: user });

const nonce = Date.now();
const step1Id = keccak256(toHex(`final-chain-1-${nonce}`));
const step2Id = keccak256(toHex(`final-chain-2-${nonce}`));
const step1 = {
  status: 0, orderId: 0n, winningOutcome: 0,
  ...toVaultStep({
    triggerMarketId: a.marketId, successorMarketId: b.marketId, pool: b.pool,
    price: size1.price, quantity: size1.quantity,
    triggerExpiry: a.expiry, successorExpiry: b.expiry,
    actionOnWin0: 0, actionOnWin1: 2, notionalCap: 1_500000n, orderType: 0,
  }, Date.now(), step2Id),
};
const step2 = {
  status: 0, orderId: 0n, winningOutcome: 0,
  ...toVaultStep({
    triggerMarketId: b.marketId, successorMarketId: c.marketId, pool: c.pool,
    price: size2.price, quantity: size2.quantity,
    triggerExpiry: b.expiry, successorExpiry: c.expiry,
    actionOnWin0: 0, actionOnWin1: 2, notionalCap: 1_500000n, orderType: 0,
  }, Date.now(), ZERO32),
};

const queued = await send(userWallet, { address: vault, abi: vaultAbi, functionName: "queueStep", args: [step2Id, step2], account: user });
const armed = await send(userWallet, { address: vault, abi: vaultAbi, functionName: "armStep", args: [step1Id, step1], account: user });
const fromBlock = armed.receipt.blockNumber;

// Exactly one registration call. The manager must discover B from the stored
// nextStepId and subscribe A + B atomically.
const registered = await send(userWallet, {
  address: manager, abi: managerAbi, functionName: "register", args: [vault, a.marketId], account: user,
});
const subKey = (marketId) => keccak256(encodePacked(["address", "bytes32"], [vault, marketId]));
const [subA, subB, liveForVault] = await Promise.all([
  pub.readContract({ address: manager, abi: managerAbi, functionName: "subscriptionOf", args: [subKey(a.marketId)] }),
  pub.readContract({ address: manager, abi: managerAbi, functionName: "subscriptionOf", args: [subKey(b.marketId)] }),
  pub.readContract({ address: manager, abi: managerAbi, functionName: "liveSubscriptionsByVault", args: [vault] }),
]);
if (subA === 0n || subB === 0n || liveForVault < 2n) {
  throw new Error(`one-call registration did not cover both markets: A=${subA} B=${subB} live=${liveForVault}`);
}
console.log(`one register tx created A sub ${subA} and B sub ${subB}`);
console.log(txUrl(registered.hash));
console.log("trader has left. The script will only READ until both settlements finish; it never calls syncResolution.");

// ---- wait for both dependent steps -----------------------------------------
// Wait as long as the second market actually needs. Capping at three hours meant
// a chain whose second settlement was three and a half hours out timed out half
// an hour short of the thing it was measuring.
const deadline = Date.now() + Math.max(40 * 60 * 1000, Math.min(6 * 60 * 60 * 1000, (b.expiry - now + 900) * 1000));
let last = "";
while (Date.now() < deadline) {
  const [s1raw, s2raw] = await Promise.all([
    pub.readContract({ address: vault, abi: vaultAbi, functionName: "stepStatus", args: [step1Id] }),
    pub.readContract({ address: vault, abi: vaultAbi, functionName: "stepStatus", args: [step2Id] }),
  ]);
  const s1 = STATUS[Number(s1raw)];
  const s2 = STATUS[Number(s2raw)];
  const line = `step1=${s1} step2=${s2}`;
  if (line !== last) { console.log(line); last = line; }
  if (["PLACED", "SKIPPED", "EXPIRED", "CANCELLED"].includes(s1) && ["PLACED", "SKIPPED", "EXPIRED", "CANCELLED"].includes(s2)) break;
  await sleep(15000);
}

const final1 = STATUS[Number(await pub.readContract({ address: vault, abi: vaultAbi, functionName: "stepStatus", args: [step1Id] }))];
const final2 = STATUS[Number(await pub.readContract({ address: vault, abi: vaultAbi, functionName: "stepStatus", args: [step2Id] }))];
const latest = await pub.getBlockNumber();
const rawLogs = [];
for (let f = fromBlock; f <= latest; f += 1000n) {
  const t = f + 999n > latest ? latest : f + 999n;
  try { rawLogs.push(...await pub.getLogs({ address: vault, fromBlock: f, toBlock: t })); } catch { /* Shannon range/rate failure: continue */ }
}
const decoded = parseEventLogs({ abi: vaultAbi, logs: rawLogs, strict: false });
const timeline = decoded.map((e) => ({
  event: e.eventName,
  stepId: e.args?.stepId || null,
  marketId: e.args?.marketId || e.args?.triggerMarketId || null,
  txHash: e.transactionHash,
  blockNumber: e.blockNumber.toString(),
}));
const syncUsed = timeline.some((e) => e.event === "ResolutionSynced");
const step1Events = timeline.filter((e) => e.stepId === step1Id).map((e) => e.event);
const step2Events = timeline.filter((e) => e.stepId === step2Id).map((e) => e.event);
const chainAdvanced = timeline.some((e) => e.event === "ChainAdvanced" && e.stepId === step1Id);

const checks = [
  ["one registration covered the first trigger", subA !== 0n, subA.toString()],
  ["one registration covered the queued second trigger up front", subB !== 0n, subB.toString()],
  ["step 1 placed automatically", final1 === "PLACED" && step1Events.includes("Triggered") && step1Events.includes("Placed"), `${step1Events.join(" -> ")} [${final1}]`],
  ["step 1 activated the queued step", chainAdvanced || step2Events.includes("StepArmed"), timeline.filter((e) => e.event === "ChainAdvanced" || e.stepId === step2Id).map((e) => e.event).join(" -> ")],
  ["step 2 placed automatically after its own later settlement", final2 === "PLACED" && step2Events.includes("Triggered") && step2Events.includes("Placed"), `${step2Events.join(" -> ")} [${final2}]`],
  ["no recovery sync drove either step", !syncUsed, syncUsed ? "ResolutionSynced present" : "no ResolutionSynced"],
  ["trader never carried the 32 STT infrastructure stake", (await pub.getBalance({ address: user.address })) < 32n * 10n ** 18n, stt(await pub.getBalance({ address: user.address }))],
];
let bad = 0;
console.log("");
for (const [check, pass, detail] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${check} — ${detail}`);
  if (!pass) bad++;
}

const evidence = {
  question: "Can one user activate a dependent two-step Sequence once and leave, with Somnia Reactivity advancing both settlements automatically?",
  answer: bad === 0 ? "Yes. One registration subscribed both stored trigger markets; step 1 and step 2 each triggered and placed from Reactivity with no ResolutionSynced call." : "Not fully proven; see failing checks.",
  manager,
  wallet: user.address,
  vault,
  gasSeedTx: gasSeed,
  vaultCreatedTx: created.hash,
  vaultFundedTx: funded.hash,
  queueTx: queued.hash,
  armTx: armed.hash,
  registerTx: registered.hash,
  markets: {
    firstTrigger: { id: a.marketId, name: marketName(a), expiry: a.expiry },
    firstSuccessorAndSecondTrigger: { id: b.marketId, name: marketName(b), expiry: b.expiry },
    secondSuccessor: { id: c.marketId, name: marketName(c), expiry: c.expiry },
  },
  steps: {
    first: { id: step1Id, finalStatus: final1, notional: orderCost(size1.price, size1.quantity).toString() },
    second: { id: step2Id, finalStatus: final2, notional: orderCost(size2.price, size2.quantity).toString() },
  },
  subscriptions: { first: subA.toString(), second: subB.toString(), liveForVault: liveForVault.toString() },
  timeline,
  checks: checks.map(([check, pass, detail]) => ({ check, pass, detail: String(detail) })),
  provenAt: new Date().toISOString(),
};
writeFileSync(join(repo, "docs", "CHAINED_REACTIVITY_LIVE.json"), JSON.stringify(evidence, null, 2) + "\n");

// Cleanup subscriptions only after evidence is captured. The onchain trigger and
// placement transactions remain immutable, but old resolved subscriptions stop
// consuming project infrastructure.
const cleanup = [];
for (const marketId of [a.marketId, b.marketId]) {
  try {
    const r = await send(userWallet, { address: manager, abi: managerAbi, functionName: "unregister", args: [vault, marketId], account: user });
    cleanup.push(r.hash);
    console.log(`cleanup ${marketId.slice(-8)} ${txUrl(r.hash)}`);
  } catch (e) {
    console.log(`cleanup warning ${marketId.slice(-8)}: ${e.shortMessage || e.message}`);
  }
}
evidence.cleanupTxs = cleanup;
writeFileSync(join(repo, "docs", "CHAINED_REACTIVITY_LIVE.json"), JSON.stringify(evidence, null, 2) + "\n");

console.log(`\n${bad === 0 ? "FULL TWO-STEP HANDS-OFF SEQUENCE PROVEN" : `${bad} proof check(s) failed`}`);
console.log("evidence: docs/CHAINED_REACTIVITY_LIVE.json");
process.exit(bad === 0 ? 0 : 1);
