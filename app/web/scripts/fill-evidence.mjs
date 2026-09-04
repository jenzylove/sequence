// Reconstructs what actually moved in the proven live-fire transaction, from
// the receipt itself, so the claim rests on chain data rather than on memory.
//
//   node scripts/fill-evidence.mjs <txHash> <vault>
import { createPublicClient, http, parseEventLogs, decodeEventLog } from "viem";
import { writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHANNON, shannonChain, txUrl } from "../src/chain/config.js";
import { vaultAbi } from "../src/chain/abi.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const [, , txHash, vaultArg] = process.argv;
if (!txHash) throw new Error("usage: node scripts/fill-evidence.mjs <txHash> <vault>");

const pub = createPublicClient({ chain: shannonChain, transport: http(SHANNON.rpc) });
const receipt = await pub.getTransactionReceipt({ hash: txHash });
const vault = (vaultArg || "").toLowerCase();
const usd = (raw) => `$${(Number(raw) / 1e6).toFixed(4)}`;

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const erc20 = [{ type: "event", name: "Transfer", inputs: [
  { type: "address", name: "from", indexed: true },
  { type: "address", name: "to", indexed: true },
  { type: "uint256", name: "value" },
]}];

// Collateral in and out of the vault.
let paid = 0n, refunded = 0n;
const collateralMoves = [];
for (const log of receipt.logs) {
  if (log.topics[0] !== TRANSFER) continue;
  if (log.address.toLowerCase() !== SHANNON.testUsdc.toLowerCase()) continue;
  const { args } = decodeEventLog({ abi: erc20, data: log.data, topics: log.topics });
  const from = args.from.toLowerCase(), to = args.to.toLowerCase();
  if (from === vault) { paid += args.value; collateralMoves.push({ direction: "out", to: args.to, amount: args.value.toString() }); }
  if (to === vault) { refunded += args.value; collateralMoves.push({ direction: "in", from: args.from, amount: args.value.toString() }); }
}

// Outcome positions credited to the vault, from the ERC-6909 singleton.
const positions = [];
for (const log of receipt.logs) {
  if (log.address.toLowerCase() !== SHANNON.outcomeToken?.toLowerCase()) continue;
  positions.push({ topics: log.topics, data: log.data });
}

// What the vault itself said happened.
const ours = parseEventLogs({ abi: vaultAbi, logs: receipt.logs.filter((l) => l.address.toLowerCase() === vault) });
const placed = ours.find((e) => e.eventName === "Placed");

const net = paid - refunded;
const evidence = {
  note: "What moved in the transaction that carried the live-fire sequence, read from its receipt.",
  tx: txHash,
  explorer: txUrl(txHash),
  block: receipt.blockNumber.toString(),
  status: receipt.status,
  vault: vaultArg,
  vaultEvents: ours.map((e) => ({
    event: e.eventName,
    args: Object.fromEntries(Object.entries(e.args || {}).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])),
  })),
  collateral: {
    movedToPool: paid.toString(),
    returnedToVault: refunded.toString(),
    netSpent: net.toString(),
    readable: `${usd(paid)} out, ${usd(refunded)} back, net ${usd(net)}`,
    moves: collateralMoves,
  },
  order: placed ? {
    orderId: placed.args.orderId?.toString(),
    side: Number(placed.args.kind) === 2 ? "BUY_NO" : "BUY_YES",
    notionalCommitted: placed.args.notional?.toString(),
    pool: placed.args.pool,
  } : null,
  outcomeTokenLogEntries: positions.length,
  claim: placed
    ? (net > 0n
        ? `The pool accepted the bounded order and ${usd(net)} of collateral was consumed net, which is consistent with a fill. The vault cannot observe fill quantity from inside the callback, so no fill size is asserted here beyond the collateral delta.`
        : "The pool accepted the bounded order. No net collateral was consumed in this transaction, so no fill is claimed.")
    : "No Placed event in this transaction.",
};

const out = join(repo, "docs", "FILL_EVIDENCE.json");
writeFileSync(out, JSON.stringify(evidence, null, 2) + "\n");
console.log(evidence.claim);
console.log(`collateral: ${evidence.collateral.readable}`);
console.log(`order id:   ${evidence.order?.orderId ?? "none"} (${evidence.order?.side ?? "-"})`);
console.log(`written to docs/FILL_EVIDENCE.json`);
process.exit(0);
