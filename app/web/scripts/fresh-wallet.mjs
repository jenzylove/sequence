// Proves the journey for a wallet that is not the author's.
//
// The browser suite injects an address and never signs, so it can only show the
// interface reaching provisioning. This uses a genuinely new keypair, funded
// only with gas, and makes it sign for itself: create its own vault through the
// factory, confirm it sees nothing of anyone else's, and activate a real
// sequence. Evidence is written to docs/FRESH_WALLET.json.
import { createWalletClient, createPublicClient, http, keccak256, toHex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHANNON, shannonChain, txUrl } from "../src/chain/config.js";
import { vaultAbi } from "../src/chain/abi.js";
import { factoryAbi } from "../src/chain/factoryAbi.js";
import { fetchOpenMarkets, fetchBook, crossingPrice, fetchPoolParams, sizeOrder, orderCost } from "../src/chain/markets.js";
import { nextWindowFor } from "../src/strategy.js";
import { marketName } from "../src/lib/language.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const evidencePath = join(repo, "docs", "FRESH_WALLET.json");

const env = Object.fromEntries(
  readFileSync(join(repo, ".env"), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const pub = createPublicClient({ chain: shannonChain, transport: http(SHANNON.rpc) });
const funder = privateKeyToAccount(env.PRIVATE_KEY);
const funderWallet = createWalletClient({ account: funder, chain: shannonChain, transport: http(SHANNON.rpc) });

// A brand new keypair. Nobody has ever used it, and it owns nothing.
const key = generatePrivateKey();
const fresh = privateKeyToAccount(key);
const freshWallet = createWalletClient({ account: fresh, chain: shannonChain, transport: http(SHANNON.rpc) });

const say = (...a) => console.log(...a);
const usd = (raw) => `$${(Number(raw) / 1e6).toFixed(3)}`;
const steps = [];
const record = (name, detail, tx = null) => { steps.push({ name, detail, tx }); say(`  ${name}: ${detail}${tx ? `\n     ${txUrl(tx)}` : ""}`); };

say(`fresh wallet ${fresh.address}\nfactory      ${SHANNON.factory}\n`);

// ---- it starts with nothing --------------------------------------------
const before = await pub.readContract({
  address: SHANNON.factory, abi: factoryAbi, functionName: "vaultFor", args: [fresh.address],
});
if (before !== "0x0000000000000000000000000000000000000000") throw new Error("a new wallet already has a vault");
record("starts with no account", `factory.vaultFor() returns the zero address, so the app offers to create one`);

// ---- gas only ------------------------------------------------------------
const gas = 400000000000000000n; // 0.4 SOM, enough to deploy and arm
const fundTx = await funderWallet.sendTransaction({ to: fresh.address, value: gas });
await pub.waitForTransactionReceipt({ hash: fundTx });
record("funded with gas only", `0.4 SOM, no collateral and no stake`, fundTx);

// ---- it creates its OWN vault -------------------------------------------
const { request } = await pub.simulateContract({
  address: SHANNON.factory, abi: factoryAbi, functionName: "createVault",
  args: [3000000n], account: fresh,
});
const createTx = await freshWallet.writeContract(request);
await pub.waitForTransactionReceipt({ hash: createTx });
const vault = await pub.readContract({
  address: SHANNON.factory, abi: factoryAbi, functionName: "vaultFor", args: [fresh.address],
});
record("created its own account", `${vault}`, createTx);

// ---- it owns it, and nobody else does -----------------------------------
const owner = await pub.readContract({ address: vault, abi: vaultAbi, functionName: "owner" });
if (owner.toLowerCase() !== fresh.address.toLowerCase()) throw new Error("the fresh wallet does not own its vault");
const authorVault = await pub.readContract({
  address: SHANNON.factory, abi: factoryAbi, functionName: "vaultFor", args: [funder.address],
});
if (authorVault.toLowerCase() === vault.toLowerCase()) throw new Error("the two wallets share a vault");
record("owns it exclusively", `owner is the fresh wallet; the author's vault is a different address (${authorVault})`);

// The author must not be able to touch it.
let blocked = false;
try {
  await pub.simulateContract({ address: vault, abi: vaultAbi, functionName: "setPaused", args: [true], account: funder });
} catch { blocked = true; }
if (!blocked) throw new Error("another wallet could control this vault");
record("is isolated", `the author's wallet is rejected by the fresh wallet's vault`);

// ---- its own limits ------------------------------------------------------
const limit = await pub.readContract({ address: vault, abi: vaultAbi, functionName: "maxOutstandingNotional" });
record("carries its own risk limit", `${usd(limit)}, chosen at creation, not inherited`);

// ---- build, simulate, activate -------------------------------------------
const open = await fetchOpenMarkets(40);
const now = Math.floor(Date.now() / 1000);
let trigger = null, successor = null;
for (const c of open.filter((m) => (m.expiry || 0) - now > 60).sort((a, b) => a.expiry - b.expiry)) {
  const next = nextWindowFor(open, c);
  if (next && (next.expiry || 0) > (c.expiry || 0) + 60) { trigger = c; successor = next; break; }
}
if (!trigger) throw new Error("no market pair open to build with");

const book = await fetchBook(successor.marketId);
const params = await fetchPoolParams(successor.pool, pub);
const budget = 1000000n;
const sized = sizeOrder({ price: crossingPrice(book, false) ?? 500000n, budget, ...params });
if (!sized) throw new Error("cannot size an order inside the budget");
record("built a sequence", `watch ${marketName(trigger)} -> trade ${marketName(successor)}, ${sized.quantity} @ ${usd(sized.price)} = ${usd(sized.cost)}`);

// Simulated the same way the interface does: the rules are checked before signing.
if (sized.cost > budget) throw new Error("simulation says the order exceeds its budget");
if (sized.cost > limit) throw new Error("simulation says the order exceeds the account limit");
record("simulated within its limits", `${usd(sized.cost)} is inside both the ${usd(budget)} budget and the ${usd(limit)} account limit`);

const stepId = keccak256(toHex(`fresh-${fresh.address}-${Date.now()}`));
const step = {
  status: 0, triggerMarketId: trigger.marketId, pool: successor.pool,
  price: sized.price, quantity: sized.quantity,
  expireNs: BigInt(successor.expiry) * 1_000_000_000n,
  orderType: 2, actionOnWin0: 0, actionOnWin1: 2,
  notionalCap: budget, successorMarketId: successor.marketId,
  nextStepId: `0x${"00".repeat(32)}`, orderId: 0n, winningOutcome: 0,
};
const armReq = await pub.simulateContract({
  address: vault, abi: vaultAbi, functionName: "armStep", args: [stepId, step], account: fresh,
});
const armTx = await freshWallet.writeContract(armReq.request);
const armRcpt = await pub.waitForTransactionReceipt({ hash: armTx });
const status = await pub.readContract({ address: vault, abi: vaultAbi, functionName: "stepStatus", args: [stepId] });
record("activated it, signing for itself", `step status ${status} (1 = live and waiting)`, armTx);

writeFileSync(evidencePath, JSON.stringify({
  note: "A genuinely new wallet completing the journey and signing for itself. No address injection.",
  freshWallet: fresh.address,
  freshVault: vault,
  authorWallet: funder.address,
  authorVault,
  factory: SHANNON.factory,
  riskLimit: limit.toString(),
  fundedWith: `${Number(gas) / 1e18} SOM (gas only)`,
  stepId,
  order: { price: sized.price.toString(), quantity: sized.quantity.toString(), cost: sized.cost.toString() },
  stepStatus: Number(status),
  transactions: { funded: fundTx, createdVault: createTx, activated: armTx },
  armedBlock: armRcpt.blockNumber.toString(),
  at: new Date().toISOString(),
  steps,
  notFunded: "This vault holds no collateral and no subscription stake, so it can arm but not execute. That is stated rather than implied.",
}, null, 2) + "\n");

say(`\nevidence written to docs/FRESH_WALLET.json`);
say(`fresh vault ${vault} owned by ${fresh.address}`);
process.exit(0);
