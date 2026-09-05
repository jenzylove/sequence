// Redeem one settled winning position the vault already holds, and record what
// moved. Reads before and after so the evidence is a balance delta, not a claim.
//
//   node scripts/redeem-now.mjs <marketId>
import { createWalletClient, createPublicClient, http, parseEventLogs, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHANNON, shannonChain, txUrl } from "../src/chain/config.js";
import { vaultAbi } from "../src/chain/abi.js";
import { factoryAbi } from "../src/chain/factoryAbi.js";
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

const marketId = process.argv[2];
if (!marketId) throw new Error("usage: node scripts/redeem-now.mjs <marketId>");

const vault = await pub.readContract({
  address: SHANNON.factory, abi: factoryAbi, functionName: "vaultFor", args: [account.address],
});
const collateralOf = () => pub.readContract({
  address: SHANNON.testUsdc, abi: erc20Abi, functionName: "balanceOf", args: [vault],
});

const record = await readMarketRecord(marketId);
const settlement = await readSettlement(record.yesId);
const before = await readOutcomeBalances(vault, { ...record, outcomeToken: settlement.outcomeToken });
const cashBefore = await collateralOf();

say("vault      " + vault);
say("market     " + marketId);
say("settled    finalized=" + settlement.finalized + " voided=" + settlement.voided + " winner=" + settlement.winner);
say("holds      YES " + before.yes + "  NO " + before.no);
say("collateral " + usd(cashBefore));

const { request } = await pub.simulateContract({
  address: vault, abi: vaultAbi, functionName: "redeemPosition", args: [marketId], account,
});
const hash = await wallet.writeContract(request);
const receipt = await pub.waitForTransactionReceipt({ hash });
say("\nredeemPosition: " + receipt.status + "  " + txUrl(hash));

const cashAfter = await collateralOf();
const after = await readOutcomeBalances(vault, { ...record, outcomeToken: settlement.outcomeToken });
const events = parseEventLogs({ abi: vaultAbi, logs: receipt.logs })
  .filter((e) => e.eventName === "Redeemed")
  .map((e) => Object.fromEntries(Object.entries(e.args).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])));

say("collateral " + usd(cashBefore) + " -> " + usd(cashAfter) + "  (+" + usd(cashAfter - cashBefore) + ")");
say("holds      YES " + after.yes + "  NO " + after.no);
say("events     " + JSON.stringify(events));

const all = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, "utf8")) : { attempts: [] };
all.proof = {
  note: "A position taken through the product's own path, on a market that settled, redeemed back into spendable collateral.",
  vault,
  marketId,
  marketAddress: record.market,
  settlement: {
    finalized: settlement.finalized, voided: settlement.voided,
    winner: settlement.winner, payouts: settlement.payouts.map(String),
  },
  heldBefore: { yes: before.yes.toString(), no: before.no.toString() },
  heldAfter: { yes: after.yes.toString(), no: after.no.toString() },
  collateralBefore: cashBefore.toString(),
  collateralAfter: cashAfter.toString(),
  collateralGained: (cashAfter - cashBefore).toString(),
  redeemedEvents: events,
  txHash: hash,
  explorer: txUrl(hash),
  blockNumber: receipt.blockNumber.toString(),
  redeemedAt: new Date().toISOString(),
};
writeFileSync(evidencePath, JSON.stringify(all, null, 2) + "\n");
say("\nwritten to docs/REDEMPTION.json");
process.exit(0);
