// Reconstructs a live-fire run from chain and appends it to docs/LIVE_FIRE.json.
//
// Used when a run genuinely completed but the watcher lost its connection before
// it could write the record. Everything here is read back from the vault's own
// logs, so the evidence is the chain's, not the script's memory.
//
//   node scripts/record-run.mjs <armStepTxHash>
import { createPublicClient, http, parseEventLogs } from "viem";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHANNON, shannonChain, txUrl } from "../src/chain/config.js";
import { vaultAbi } from "../src/chain/abi.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const path = join(repo, "docs", "LIVE_FIRE.json");
const pub = createPublicClient({ chain: shannonChain, transport: http(SHANNON.rpc) });
const STATUS = ["NONE", "ARMED", "WAITING", "TRIGGERED", "PLACED", "SKIPPED", "EXPIRED", "CANCELLED", "PENDING"];
const say = (...a) => console.log(...a);

const armTx = process.argv[2];
if (!armTx) throw new Error("usage: node scripts/record-run.mjs <armStepTxHash>");

const vault = SHANNON.vault;
const armed = await pub.getTransactionReceipt({ hash: armTx });
const latest = await pub.getBlockNumber();

const logs = [];
for (let f = armed.blockNumber; f <= latest; f += 1000n) {
  const t = f + 999n > latest ? latest : f + 999n;
  try { logs.push(...await pub.getLogs({ address: vault, fromBlock: f, toBlock: t })); } catch { /* window unavailable */ }
}
const parsed = parseEventLogs({ abi: vaultAbi, logs });
const stepId = parsed.find((e) => e.eventName === "StepArmed")?.args?.stepId;
if (!stepId) throw new Error("no StepArmed event found from that transaction onward");

const mine = parsed.filter((e) => !e.args?.stepId || e.args.stepId === stepId);
const timeline = mine.map((e) => ({
  event: e.eventName,
  args: Object.fromEntries(Object.entries(e.args || {}).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])),
  blockNumber: e.blockNumber.toString(),
  txHash: e.transactionHash,
  logIndex: e.logIndex,
}));

const status = STATUS[Number(await pub.readContract({ address: vault, abi: vaultAbi, functionName: "stepStatus", args: [stepId] }))];
const step = await pub.readContract({ address: vault, abi: vaultAbi, functionName: "steps", args: [stepId] });
const placed = timeline.find((t) => t.event === "Placed");
const skipped = timeline.find((t) => t.event === "Skipped");

const all = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { runs: [] };
if (all.runs.some((r) => r.stepId === stepId)) { say("already recorded"); process.exit(0); }

const run = {
  note: "Reconstructed from chain after the watcher lost its connection. Every field is read from the vault's own logs.",
  vault,
  factory: SHANNON.factory,
  stepId,
  armedTx: armTx,
  armedBlock: armed.blockNumber.toString(),
  trigger: { marketId: step.triggerMarketId ?? step[1] },
  successor: { marketId: step.successorMarketId ?? step[10], pool: step.pool ?? step[2] },
  advancedBy: timeline.some((t) => t.event === "ResolutionSynced") ? "syncResolution" : "reactivity",
  timeline,
  finalStatus: status,
  outcome: placed ? "placed" : skipped ? `skipped: ${skipped.args.reason}` : status.toLowerCase(),
  explorer: txUrl(armTx),
  recordedAt: new Date().toISOString(),
};
all.runs.push(run);
writeFileSync(path, JSON.stringify(all, null, 2) + "\n");
say(`recorded run ${all.runs.length}: ${timeline.map((t) => t.event).join(" -> ")}  [${status}]`);
process.exit(0);
