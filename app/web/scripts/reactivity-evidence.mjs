// Did OracleHub's AnswerDelivered actually invoke the SequenceVault handler?
//
// An earlier version of this script answered that question wrongly, and the way
// it was wrong is worth stating plainly: it passed a raw `topics` array to
// viem's `getLogs`, which builds its topic filter from `event`/`args` and
// ignores that field entirely. So it fetched every OracleHub log in the range
// and took the first one, which was a DrainContinuation, and then printed a
// hard-coded sentence claiming the event matched the subscription filter - while
// the very same file recorded matchesSubscriptionFilter: false.
//
// This version fixes both halves. The query is ABI-aware, and nothing is
// asserted: every field is validated against the verified constants before a
// verdict is allowed, and if validation fails the run is INCONCLUSIVE and no
// verdict is written at all.
//
//   node scripts/reactivity-evidence.mjs
import { createPublicClient, http, parseAbiItem, decodeEventLog } from "viem";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHANNON, shannonChain, txUrl } from "../src/chain/config.js";
import { vaultAbi } from "../src/chain/abi.js";
import { Verified } from "./verified-constants.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const pub = createPublicClient({ chain: shannonChain, transport: http(SHANNON.rpc) });
const say = (...a) => console.log(...a);

// The exact event, by signature. Its topic0 is checked against the independently
// verified constant below, so a wrong signature here cannot slip through.
const ANSWER_DELIVERED = parseAbiItem(
  "event AnswerDelivered(uint256 indexed questionId, bytes32 indexed marketId, uint32 adapterId, uint256[] payoutNumerators, bool isVoid)",
);

// Two modes. By default we ask about one armed run and therefore demand that the
// event names that run's exact trigger market. With --any we ask the broader and
// equally fair question: the subscription wildcards topics 1-3, so it should
// fire on ANY AnswerDelivered from OracleHub. In that mode topic2 is
// unconstrained by the subscription itself, so requiring a particular value
// would be testing something the subscription never asked for - it is recorded
// rather than asserted, and everything else is still validated.
const anyMode = process.argv.includes("--any");

const expPath = join(repo, "docs", "REACTIVITY_EXPERIMENT.json");
const experiment = JSON.parse(readFileSync(expPath, "utf8"));
const firePath = join(repo, "docs", "LIVE_FIRE.json");
const fire = JSON.parse(readFileSync(firePath, "utf8"));

// The run to examine: the most recent one armed while the subscription was live.
const runId = process.argv.slice(2).find((a) => !a.startsWith("--"));
const onDeployedVault = fire.runs.filter((r) => r.vault?.toLowerCase() === SHANNON.vault.toLowerCase());
const run = runId
  ? fire.runs.find((r) => r.stepId === runId || r.armedTx === runId)
  : (onDeployedVault[onDeployedVault.length - 1] ?? fire.runs[fire.runs.length - 1]);
if (!run) throw new Error("no live-fire run to examine");

const vault = run.vault;
const triggerMarketId = run.trigger.marketId;
const armedBlock = BigInt(run.armedBlock);

say(`vault    ${vault}`);
say(`trigger  ${triggerMarketId}`);
say(`armed at ${armedBlock}\n`);

// ---- 1. find a genuinely matching AnswerDelivered ---------------------------
// ABI-aware: viem derives topics from the event and its indexed args.
const latest = await pub.getBlockNumber();
// In --any mode the question is about the subscription, so the scan starts where
// the subscription started rather than where a particular step was armed.
let scanFrom = armedBlock;
if (anyMode && experiment.subscription?.subscribeTx) {
  try {
    const r = await pub.getTransactionReceipt({ hash: experiment.subscription.subscribeTx });
    scanFrom = r.blockNumber;
  } catch { /* fall back to the armed block */ }
}
const candidates = [];
for (let from = scanFrom; from <= latest; from += 1000n) {
  const to = from + 999n > latest ? latest : from + 999n;
  try {
    const logs = await pub.getLogs({
      address: Verified.ORACLE_HUB,
      event: ANSWER_DELIVERED,
      ...(anyMode ? {} : { args: { marketId: triggerMarketId } }),
      fromBlock: from,
      toBlock: to,
    });
    candidates.push(...logs);
  } catch { /* window unavailable */ }
}

// ---- 2. validate before believing anything ----------------------------------
// Each of these is a reason to throw the log away, not a reason to caveat it.
function validate(log) {
  const checks = [
    ["emitter is OracleHub", log.address.toLowerCase() === Verified.ORACLE_HUB.toLowerCase(), log.address],
    ["topic0 is the verified AnswerDelivered", log.topics[0]?.toLowerCase() === Verified.ANSWER_DELIVERED_TOPIC0.toLowerCase(), log.topics[0]],
    ...(anyMode
      ? [["topic2 is a market id (unconstrained: the subscription wildcards topics 1-3)", typeof log.topics[2] === "string" && log.topics[2].length === 66, log.topics[2]]]
      : [["topic2 is the exact trigger marketId", log.topics[2]?.toLowerCase() === triggerMarketId.toLowerCase(), log.topics[2]]]),
    ["log carries three topics (two indexed args)", log.topics.length === 3, String(log.topics.length)],
  ];
  let decoded = null;
  try {
    decoded = decodeEventLog({ abi: [ANSWER_DELIVERED], data: log.data, topics: log.topics });
    checks.push(["decodes as AnswerDelivered", decoded.eventName === "AnswerDelivered", decoded.eventName]);
  } catch (e) {
    checks.push(["decodes as AnswerDelivered", false, e.message.slice(0, 60)]);
  }
  return { checks, decoded, ok: checks.every(([, pass]) => pass) };
}

let matched = null;
for (const log of candidates) {
  const v = validate(log);
  say(`candidate ${log.transactionHash}`);
  for (const [label, pass, detail] of v.checks) say(`   ${pass ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  if (v.ok) { matched = { log, decoded: v.decoded, checks: v.checks }; break; }
}

if (!matched) {
  const result = {
    status: "INCONCLUSIVE",
    question: "Under a guaranteed, EOA-owned subscription, does OracleHub's AnswerDelivered invoke the SequenceVault handler?",
    answer: "Not determined. No log passed validation as an AnswerDelivered for this exact trigger market, so there is nothing to draw a conclusion from.",
    verdict: null,
    candidatesInspected: candidates.length,
    scanned: { fromBlock: scanFrom.toString(), toBlock: latest.toString(), mode: anyMode ? "any AnswerDelivered (subscription wildcards topics 1-3)" : "this run's trigger market only", triggerMarketId },
    note: "No Reactivity verdict may be written without a validated matching event. Wait for a real settlement and run again.",
    capturedAt: new Date().toISOString(),
  };
  writeFileSync(expPath, JSON.stringify({ ...experiment, result }, null, 2) + "\n");
  say(`\nINCONCLUSIVE — ${candidates.length} candidate(s), none validated. No verdict written.`);
  process.exit(2);
}

const log = matched.log;
say(`\nvalidated AnswerDelivered ${log.transactionHash} in block ${log.blockNumber}`);

// ---- 3. was the handler invoked, at ANY call depth? -------------------------
// A reactive callback need not be a top-level transaction, so counting block
// transactions is not sufficient evidence on its own. callTracer walks the whole
// call tree, which is the evidence source that can actually answer this.
async function traceBlock(blockNumber) {
  const body = {
    jsonrpc: "2.0", id: 1, method: "debug_traceBlockByNumber",
    params: ["0x" + blockNumber.toString(16), { tracer: "callTracer" }],
  };
  const res = await fetch(SHANNON.rpc, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const json = await res.json();
  if (json.error) return { available: false, error: json.error.message, calls: [] };
  return { available: true, traces: json.result || [] };
}

// The caller and the selector are the whole proof. A count of calls to an
// address says nothing; "the precompile called onEvent on our vault and it did
// not revert" is the claim, so those are the fields recorded.
function walk(node, out, depth = 0, txHash = null) {
  if (!node) return out;
  out.push({
    depth, type: node.type, from: node.from, to: node.to,
    selector: (node.input || "").slice(0, 10),
    error: node.error ?? null,
    txHash,
  });
  for (const c of node.calls || []) walk(c, out, depth + 1, txHash);
  return out;
}

const trace = await traceBlock(log.blockNumber);
let dispatch = null;
if (trace.available) {
  const frames = [];
  for (const t of trace.traces) walk(t.result, frames, 0, t.txHash);
  const toVault = frames.filter((f) => f.to?.toLowerCase() === vault.toLowerCase());
  const fromPrecompile = frames.filter((f) => f.from?.toLowerCase() === Verified.REACTIVITY_PRECOMPILE.toLowerCase());
  const toPrecompile = frames.filter((f) => f.to?.toLowerCase() === Verified.REACTIVITY_PRECOMPILE.toLowerCase());
  // A dispatch is only counted when the precompile is the caller, the selector is
  // onEvent, and the frame did not revert.
  const ON_EVENT = "0x53edf33d";
  const dispatches = toVault.filter((f) =>
    f.from?.toLowerCase() === Verified.REACTIVITY_PRECOMPILE.toLowerCase()
    && f.selector === ON_EVENT);
  const succeeded = dispatches.filter((f) => !f.error);
  dispatch = {
    evidenceSource: "debug_traceBlockByNumber with callTracer, walked to every depth",
    totalCallFrames: frames.length,
    callsToTheVaultAtAnyDepth: toVault.length,
    callsFromThePrecompileAtAnyDepth: fromPrecompile.length,
    callsToThePrecompileAtAnyDepth: toPrecompile.length,
    handlerDispatchesFromPrecompile: dispatches.length,
    handlerDispatchesThatSucceeded: succeeded.length,
    onEventSelector: ON_EVENT,
    frames: dispatches.map((f) => ({
      txHash: f.txHash, depth: f.depth, type: f.type,
      from: f.from, to: f.to, selector: f.selector, error: f.error,
    })),
  };
  say(`trace: ${frames.length} call frames, ${toVault.length} to the vault, ${fromPrecompile.length} from the precompile`);
} else {
  dispatch = { evidenceSource: "unavailable", error: trace.error };
  say(`trace unavailable: ${trace.error}`);
}

// ---- 4. the vault's own account of itself -----------------------------------
const vaultLogs = [];
for (let from = log.blockNumber; from <= log.blockNumber + 200n && from <= latest; from += 1000n) {
  const to = from + 999n > latest ? latest : from + 999n;
  try { vaultLogs.push(...await pub.getLogs({ address: vault, fromBlock: from, toBlock: to })); } catch { /* skip */ }
}
const STATUS = ["NONE", "ARMED", "WAITING", "TRIGGERED", "PLACED", "SKIPPED", "EXPIRED", "CANCELLED", "PENDING"];
const status = STATUS[Number(await pub.readContract({
  address: vault, abi: vaultAbi, functionName: "stepStatus", args: [run.stepId],
}))];

// ---- 5. derive the verdict from what was measured ---------------------------
const handlerInvoked = trace.available
  ? dispatch.handlerDispatchesThatSucceeded > 0
  : null;

let verdict, answer;
if (handlerInvoked === true) {
  verdict = "REACTIVITY_DELIVERS";
  answer = `Yes. In the block carrying a validated AnswerDelivered, the Reactivity precompile called onEvent (${dispatch.onEventSelector}) on the vault ${dispatch.handlerDispatchesFromPrecompile} time(s), ${dispatch.handlerDispatchesThatSucceeded} of which completed without reverting.`;
} else if (handlerInvoked === false) {
  verdict = "NO_DISPATCH_OBSERVED";
  answer = "No. A validated AnswerDelivered matching the subscription was emitted, and the call tracer shows no successful onEvent dispatch from the precompile to the vault at any depth in that block.";
} else {
  verdict = "INCONCLUSIVE";
  answer = "A validated AnswerDelivered was found, but no trace source was available to establish whether the handler was invoked.";
}

const result = {
  status: verdict === "INCONCLUSIVE" ? "INCONCLUSIVE" : "CONCLUSIVE",
  question: "Under a guaranteed, EOA-owned subscription, does OracleHub's AnswerDelivered invoke the SequenceVault handler?",
  verdict,
  answer,
  subscription: experiment.subscription,
  mode: anyMode ? "any AnswerDelivered (subscription wildcards topics 1-3)" : "this run's trigger market only",
  armedRun: { vault, stepId: run.stepId, armedTx: run.armedTx, armedBlock: run.armedBlock, triggerMarketId },
  answerDelivered: {
    txHash: log.transactionHash,
    blockNumber: log.blockNumber.toString(),
    explorer: txUrl(log.transactionHash),
    emitter: log.address,
    topic0: log.topics[0],
    questionIdTopic: log.topics[1],
    marketIdTopic: log.topics[2],
    decoded: matched.decoded ? {
      questionId: matched.decoded.args.questionId?.toString(),
      marketId: matched.decoded.args.marketId,
      adapterId: Number(matched.decoded.args.adapterId ?? 0),
      payoutNumerators: (matched.decoded.args.payoutNumerators || []).map(String),
      isVoid: matched.decoded.args.isVoid,
    } : null,
    validation: matched.checks.map(([label, pass, detail]) => ({ check: label, pass, detail: String(detail) })),
    allChecksPassed: true,
  },
  handlerDispatch: dispatch,
  vaultAfter: {
    stepStatus: status,
    eventsInTheResolvingWindow: vaultLogs.length,
  },
  capturedAt: new Date().toISOString(),
};

writeFileSync(expPath, JSON.stringify({ ...experiment, result }, null, 2) + "\n");
say(`\nverdict: ${verdict}`);
say(`written to docs/REACTIVITY_EXPERIMENT.json`);
process.exit(0);
