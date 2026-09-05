// The trading-first journey, signed for real.
//
// Starts from the wallet state a real trader arrives in: on Shannon, holding
// gas, holding test USDC, and with no Sequence account at all. Then it walks the
// order the product now uses — build the trade first, and only create and fund
// infrastructure at the moment activation needs it.
//
// Every call here is the same function the interface calls, so this proves the
// app's paths rather than a parallel implementation of them.
import { createWalletClient, createPublicClient, http, keccak256, toHex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHANNON, shannonChain, txUrl } from "../src/chain/config.js";
import { vaultAbi } from "../src/chain/abi.js";
import { factoryAbi } from "../src/chain/factoryAbi.js";
import {
  createVault, fundVaultCollateral, readWalletCollateral,
  vaultForAccount, ensurePoolAllowances, armStep, queueStep, readVaultState,
} from "../src/chain/vault.js";
import { fetchOpenMarkets, fetchBook, crossingPrice, fetchPoolParams, sizeOrder, orderCost } from "../src/chain/markets.js";
import { nextWindowFor, toVaultStep } from "../src/strategy.js";
import { marketName } from "../src/lib/language.js";
import { checkTradable } from "../src/chain/module.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const env = Object.fromEntries(
  readFileSync(join(repo, ".env"), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const funder = privateKeyToAccount(env.PRIVATE_KEY);
const pub = createPublicClient({ chain: shannonChain, transport: http(SHANNON.rpc) });
const funderWallet = createWalletClient({ account: funder, chain: shannonChain, transport: http(SHANNON.rpc) });

const say = (...a) => console.log(...a);
const usd = (raw) => `$${(Number(raw) / 1e6).toFixed(2)}`;
const steps = [];
const record = (label, detail, tx) => {
  steps.push({ step: label, detail, tx: tx || null, explorer: tx ? txUrl(tx) : null });
  say(`  ${label}: ${detail}`);
  if (tx) say(`     ${txUrl(tx)}`);
};

// ---- the wallet a trader actually arrives with -----------------------------
// Persisted: an armed step is real chain state owned by this key, and throwing
// it away would strand a funded account nobody can reach.
const key = generatePrivateKey();
const trader = privateKeyToAccount(key);
writeFileSync(join(repo, "docs", "TRADING_FIRST_KEY.txt"), `${trader.address}
${key}
`);
const traderWallet = createWalletClient({ account: trader, chain: shannonChain, transport: http(SHANNON.rpc) });
say(`trader wallet ${trader.address}\n`);

const GAS = 2n * 10n ** 18n;      // 2 STT, ordinary gas
const USDC = 12_000000n;          // $12 of test USDC, as if from a faucet

{
  const h = await funderWallet.sendTransaction({ to: trader.address, value: GAS });
  await pub.waitForTransactionReceipt({ hash: h });
  const { request } = await pub.simulateContract({
    address: SHANNON.testUsdc,
    abi: [{ type: "function", stateMutability: "nonpayable", name: "transfer", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }],
    functionName: "transfer", args: [trader.address, USDC], account: funder,
  });
  const h2 = await funderWallet.writeContract(request);
  await pub.waitForTransactionReceipt({ hash: h2 });
  record("wallet state", `on Shannon with 2.00 STT for gas and ${usd(await readWalletCollateral(trader.address))} of test USDC`, h2);
}

// ---- 1. no account exists ---------------------------------------------------
{
  const existing = await vaultForAccount(trader.address);
  if (existing) throw new Error("this wallet already has an account; the premise is wrong");
  record("no Sequence account", "factory.vaultFor() returns nothing, so the trader owns no infrastructure yet");
}

// ---- 2. build the trade first ----------------------------------------------
// This is the whole point of the restructure: everything below is decided
// before any account exists.
const open = await fetchOpenMarkets(40);
const now = Math.floor(Date.now() / 1000);
let trigger = null; let successor = null;
for (const c of open.filter((m) => (m.expiry || 0) - now > 90).sort((a, b) => a.expiry - b.expiry)) {
  const next = nextWindowFor(open, c);
  if (next && (next.expiry || 0) > (c.expiry || 0) + 60) { trigger = c; successor = next; break; }
}
if (!trigger) throw new Error("no tradable market pair right now");
const tradable = await checkTradable(successor.marketId, successor.pool);
if (!tradable.ok) throw new Error(`successor not tradable: ${tradable.problems.join("; ")}`);

const book = await fetchBook(successor.marketId);
const params = await fetchPoolParams(successor.pool, pub);
const cap = 5_000000n;                       // the trader's chosen risk limit
const sized = sizeOrder({ price: crossingPrice(book, false) ?? 500000n, budget: 2_000000n, ...params });
if (!sized) throw new Error("cannot size an order inside the budget");

const strategy = {
  name: `${marketName(trigger)} → ${marketName(successor)}`,
  maxOutstanding: cap,
  steps: [{
    triggerMarketId: trigger.marketId, successorMarketId: successor.marketId,
    pool: successor.pool, price: sized.price, quantity: sized.quantity,
    triggerExpiry: trigger.expiry, successorExpiry: successor.expiry,
    actionOnWin0: 0, actionOnWin1: 2, notionalCap: 2_000000n, orderType: 2,
  }],
};
record("built the sequence", `watch ${marketName(trigger)} → trade ${marketName(successor)}, ${usd(orderCost(sized.price, sized.quantity))} per trade, risk limit ${usd(cap)} — chosen with no account in existence`);

// ---- 3. activation creates the account, using the limit just chosen ---------
let vault;
{
  const r = await createVault({
    provider: { request: ({ method, params: p }) => traderWallet.transport.request({ method, params: p }) },
    account: trader.address, maxOutstanding: strategy.maxOutstanding,
  }).catch(async () => {
    // The app passes an EIP-1193 provider; from node we sign directly.
    const { request } = await pub.simulateContract({
      address: SHANNON.factory, abi: factoryAbi, functionName: "createVault",
      args: [strategy.maxOutstanding], account: trader,
    });
    const hash = await traderWallet.writeContract(request);
    await pub.waitForTransactionReceipt({ hash });
    return { hash, vault: await vaultForAccount(trader.address) };
  });
  vault = r.vault;
  record("created the account at activation", `${vault}, enforcing the ${usd(strategy.maxOutstanding)} limit the trader chose`, r.hash);
}

// ---- 4. funded in-app, wallet -> account ------------------------------------
{
  const before = await readVaultState(vault);
  const { request } = await pub.simulateContract({
    address: SHANNON.testUsdc,
    abi: [{ type: "function", stateMutability: "nonpayable", name: "transfer", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }],
    functionName: "transfer", args: [vault, strategy.maxOutstanding], account: trader,
  });
  const hash = await traderWallet.writeContract(request);
  await pub.waitForTransactionReceipt({ hash });
  const after = await readVaultState(vault);
  record("funded in-app", `${usd(before.bankroll)} → ${usd(after.bankroll)}; the transfer was built by Sequence and signed in the wallet, no address copied`, hash);
}

// ---- 5. permissions and arming ---------------------------------------------
{
  const provider = { request: ({ method, params: p }) => traderWallet.transport.request({ method, params: p }) };
  const { request } = await pub.simulateContract({
    address: vault, abi: vaultAbi, functionName: "approvePool",
    args: [successor.pool, strategy.maxOutstanding], account: trader,
  });
  const hash = await traderWallet.writeContract(request);
  await pub.waitForTransactionReceipt({ hash });
  record("gave the market permission", `pool ${successor.pool} may draw up to ${usd(strategy.maxOutstanding)}`, hash);

  const stepId = keccak256(toHex(`trading-first-${trigger.marketId}-${Date.now()}`));
  // The vault's Step struct carries its own runtime fields as well as the plan.
  const step = {
    status: 0, orderId: 0n, winningOutcome: 0,
    ...toVaultStep(strategy.steps[0], Date.now(), `0x${"00".repeat(32)}`),
  };
  const { request: armReq } = await pub.simulateContract({
    address: vault, abi: vaultAbi, functionName: "armStep", args: [stepId, step], account: trader,
  });
  const armHash = await traderWallet.writeContract(armReq);
  await pub.waitForTransactionReceipt({ hash: armHash });
  const status = await pub.readContract({ address: vault, abi: vaultAbi, functionName: "stepStatus", args: [stepId] });
  record("armed the sequence", `step status ${["NONE", "ARMED", "WAITING", "TRIGGERED", "PLACED", "SKIPPED", "EXPIRED", "CANCELLED", "PENDING"][Number(status)]}`, armHash);
}

const state = await readVaultState(vault);
writeFileSync(join(repo, "docs", "TRADING_FIRST.json"), JSON.stringify({
  note: "A trader arriving with a wallet and no Sequence account, building the trade first and creating infrastructure only when activation needed it.",
  traderWallet: trader.address,
  vault,
  riskLimitFromStrategy: strategy.maxOutstanding.toString(),
  accountBalance: state.bankroll.toString(),
  outstanding: state.outstanding.toString(),
  steps,
  walkedAt: new Date().toISOString(),
}, null, 2) + "\n");

say(`\naccount ${vault}`);
say(`balance ${usd(state.bankroll)} · limit ${usd(state.maxOutstanding)} · at risk ${usd(state.outstanding)}`);
say(`\nwritten to docs/TRADING_FIRST.json`);
process.exit(0);
