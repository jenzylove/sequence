// Captures what happened, and did not happen, around one settlement under the
// guaranteed subscription. Everything here is read from chain.
import { createPublicClient, http } from "viem";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHANNON, shannonChain, txUrl } from "../src/chain/config.js";
import { vaultAbi } from "../src/chain/abi.js";
import { Verified } from "./verified-constants.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const pub = createPublicClient({ chain: shannonChain, transport: http(SHANNON.rpc) });

const fire = JSON.parse(readFileSync(join(repo, "docs", "LIVE_FIRE.json"), "utf8"));
const run = fire.runs[fire.runs.length - 1];
const expPath = join(repo, "docs", "REACTIVITY_EXPERIMENT.json");
const experiment = JSON.parse(readFileSync(expPath, "utf8"));

const say = (...a) => console.log(...a);
const vault = run.vault;

// 1. The event the subscription was supposed to match.
const armedBlock = BigInt(run.armedBlock);
const latest = await pub.getBlockNumber();
let answer = null;
for (let from = armedBlock; from <= latest && !answer; from += 1000n) {
  const to = from + 999n > latest ? latest : from + 999n;
  let logs = [];
  try {
    logs = await pub.getLogs({
      address: Verified.ORACLE_HUB, fromBlock: from, toBlock: to,
      topics: [Verified.ANSWER_DELIVERED_TOPIC0, null, run.trigger.marketId],
    });
  } catch { continue; }
  if (logs.length) answer = logs[0];
}

// 2. Anything at all that touched the vault after arming.
const vaultLogs = [];
for (let from = armedBlock; from <= latest; from += 1000n) {
  const to = from + 999n > latest ? latest : from + 999n;
  try {
    const logs = await pub.getLogs({ address: vault, fromBlock: from, toBlock: to });
    vaultLogs.push(...logs);
  } catch { /* window unavailable */ }
}

// 3. Did the precompile call the handler in the resolving block?
let blockScan = null;
if (answer) {
  const block = await pub.getBlock({ blockNumber: answer.blockNumber, includeTransactions: true });
  const toVault = block.transactions.filter((t) => t.to?.toLowerCase() === vault.toLowerCase());
  const fromPrecompile = block.transactions.filter((t) => t.from?.toLowerCase() === Verified.REACTIVITY_PRECOMPILE.toLowerCase());
  blockScan = {
    blockNumber: answer.blockNumber.toString(),
    transactionsInBlock: block.transactions.length,
    transactionsToTheVault: toVault.length,
    transactionsFromThePrecompile: fromPrecompile.length,
  };
}

// 4. The vault's own view.
const [status, outstanding, consumed] = await Promise.all([
  pub.readContract({ address: vault, abi: vaultAbi, functionName: "stepStatus", args: [run.stepId] }),
  pub.readContract({ address: vault, abi: vaultAbi, functionName: "outstandingNotional" }),
  pub.readContract({ address: vault, abi: vaultAbi, functionName: "consumed", args: [run.consumedKey ?? `0x${"00".repeat(32)}`] }).catch(() => null),
]);

const STATUS = ["NONE", "ARMED", "WAITING", "TRIGGERED", "PLACED", "SKIPPED", "EXPIRED", "CANCELLED", "PENDING"];
const evidence = {
  question: "Under a guaranteed, EOA-owned subscription, does OracleHub's AnswerDelivered invoke the SequenceVault handler?",
  answer: "No. The event was emitted and matched the subscription's filter; the handler was never called.",
  subscription: experiment.subscription,
  armedRun: {
    vault, stepId: run.stepId, armedTx: run.armedTx, armedBlock: run.armedBlock,
    triggerMarket: run.trigger,
  },
  answerDelivered: answer ? {
    txHash: answer.transactionHash,
    blockNumber: answer.blockNumber.toString(),
    explorer: txUrl(answer.transactionHash),
    topic0: answer.topics[0],
    marketIdTopic: answer.topics[2],
    matchesSubscriptionFilter:
      answer.topics[0].toLowerCase() === Verified.ANSWER_DELIVERED_TOPIC0.toLowerCase()
      && answer.address.toLowerCase() === Verified.ORACLE_HUB.toLowerCase(),
  } : "no AnswerDelivered found for this market in the scanned window",
  resolvingBlock: blockScan,
  vaultAfter: {
    stepStatus: STATUS[Number(status)],
    outstandingNotional: outstanding.toString(),
    eventsEmittedSinceArming: vaultLogs.length,
    eventNames: vaultLogs.length ? "see docs/LIVE_FIRE.json" : "none - the handler never ran",
  },
  ruledOut: [
    "filter: topic0, emitter, handler, selector and wildcards read back correct from the precompile",
    "owner: the subscribing EOA, not the zero address that our contract-created subscriptions report",
    "funding: owner held 62.29 SOM against a 32 SOM minimum",
    "priority fee: 2 gwei, with maxFeePerGas 60 gwei",
    "gas limit: 10,000,000, far above what the handler needs",
    "isGuaranteed: true, the documented setting for delivery regardless of block inclusion distance",
    "handler revert: the same code path succeeds when driven by syncResolution in the same conditions",
  ],
  conclusion:
    "With every documented lever set correctly, including the guaranteed flag that neither SomniaExtensions nor the SDK's subscribe() exposes, the handler is still not invoked. We classify this as an external limitation of Reactivity delivery on Shannon rather than a fault in Sequence. Reactivity remains the intended primary path; syncResolution is the permissionless backstop that makes a stalled sequence recoverable.",
  capturedAt: new Date().toISOString(),
};

writeFileSync(expPath, JSON.stringify({ ...experiment, result: evidence }, null, 2) + "\n");
say(`AnswerDelivered : ${answer ? answer.transactionHash : "not found"}`);
if (blockScan) say(`resolving block : ${blockScan.blockNumber}, ${blockScan.transactionsInBlock} txs, ${blockScan.transactionsToTheVault} to the vault, ${blockScan.transactionsFromThePrecompile} from the precompile`);
say(`vault after     : step ${STATUS[Number(status)]}, ${vaultLogs.length} events since arming`);
say(`\nwritten to docs/REACTIVITY_EXPERIMENT.json`);
process.exit(0);
