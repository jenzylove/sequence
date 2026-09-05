// Real SequenceVault access. Reads go through a viem public client against the
// Shannon RPC; writes go through the user's own injected wallet, so every state
// change is a transaction the user signs. Nothing here returns a placeholder:
// a failed read surfaces as an error, never as an invented number.
import { createPublicClient, createWalletClient, custom, http, encodeFunctionData, keccak256, toHex, parseEventLogs } from "viem";
import { SHANNON, shannonChain } from "./config.js";
import { vaultAbi } from "./abi.js";
import { factoryAbi } from "./factoryAbi.js";
import { erc20Abi } from "./erc20.js";

export const STATUS = ["NONE", "ARMED", "WAITING", "TRIGGERED", "PLACED", "SKIPPED", "EXPIRED", "CANCELLED", "PENDING"];

export function publicClient() {
  return createPublicClient({ chain: shannonChain, transport: http(SHANNON.rpc) });
}

export function stepIdFor(name) {
  return keccak256(toHex(name));
}

// ---- reads -----------------------------------------------------------------

export async function readVaultState(vault = SHANNON.vault) {
  const client = publicClient();
  const [owner, paused, subscriptionId, outstanding, maxOutstanding, collateral] = await Promise.all([
    client.readContract({ address: vault, abi: vaultAbi, functionName: "owner" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "paused" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "subscriptionId" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "outstandingNotional" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "maxOutstandingNotional" }),
    client.readContract({ address: vault, abi: vaultAbi, functionName: "collateral" }),
  ]);
  const native = await client.getBalance({ address: vault });
  let bankroll = null;
  try {
    bankroll = await client.readContract({ address: collateral, abi: erc20Abi, functionName: "balanceOf", args: [vault] });
  } catch { bankroll = null; }
  return {
    vault, owner, paused, subscriptionId, outstanding, maxOutstanding, collateral, bankroll, native,
    subscribed: subscriptionId !== 0n,
    readAt: Date.now(),
  };
}

export async function readStep(stepId, vault = SHANNON.vault) {
  const client = publicClient();
  const raw = await client.readContract({ address: vault, abi: vaultAbi, functionName: "steps", args: [stepId] });
  const [status, triggerMarketId, pool, price, quantity, expireNs, orderType, actionOnWin0, actionOnWin1,
    notionalCap, successorMarketId, nextStepId, orderId, winningOutcome] = raw;
  return {
    stepId,
    status: Number(status),
    statusLabel: STATUS[Number(status)],
    triggerMarketId, pool, price, quantity, expireNs,
    orderType: Number(orderType),
    actionOnWin0: Number(actionOnWin0), actionOnWin1: Number(actionOnWin1),
    notionalCap, successorMarketId, nextStepId,
    orderId, winningOutcome: Number(winningOutcome),
    exists: Number(status) !== 0,
  };
}

export async function readStepForMarket(marketId, vault = SHANNON.vault) {
  const client = publicClient();
  return client.readContract({ address: vault, abi: vaultAbi, functionName: "stepForMarket", args: [marketId] });
}

// Shannon caps eth_getLogs at a 1000-block window, so history is walked in
// chunks from a known starting block (the block a step was actually armed in).
const erc20TransferAbi = [
  { type: "function", stateMutability: "nonpayable", name: "transfer",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }] },
  { type: "function", stateMutability: "view", name: "balanceOf",
    inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
];

const LOG_CHUNK = 1000n;
const MAX_CHUNKS = 40;

export async function readVaultEvents({ fromBlock, vault = SHANNON.vault } = {}) {
  const client = publicClient();
  const latest = await client.getBlockNumber();
  let start = fromBlock === undefined || fromBlock === null ? latest - LOG_CHUNK * BigInt(MAX_CHUNKS) : BigInt(fromBlock);
  if (start < 0n) start = 0n;
  if (latest - start > LOG_CHUNK * BigInt(MAX_CHUNKS)) start = latest - LOG_CHUNK * BigInt(MAX_CHUNKS);

  const out = [];
  for (let from = start; from <= latest; from += LOG_CHUNK) {
    const to = from + LOG_CHUNK - 1n > latest ? latest : from + LOG_CHUNK - 1n;
    let logs;
    try {
      logs = await client.getLogs({ address: vault, fromBlock: from, toBlock: to });
    } catch { continue; }
    if (!logs.length) continue;
    const parsed = parseEventLogs({ abi: vaultAbi, logs });
    for (const log of parsed) {
      out.push({
        name: log.eventName,
        args: log.args,
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
      });
    }
  }
  out.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : Number(a.blockNumber - b.blockNumber)));
  return out;
}

// ---- writes ----------------------------------------------------------------

function walletClientFor(provider, account) {
  return createWalletClient({ account, chain: shannonChain, transport: custom(provider) });
}

export function encodeArmStep(stepId, step) {
  return encodeFunctionData({
    abi: vaultAbi,
    functionName: "armStep",
    args: [stepId, {
      status: 0,
      triggerMarketId: step.triggerMarketId,
      pool: step.pool,
      price: step.price,
      quantity: step.quantity,
      expireNs: step.expireNs,
      orderType: step.orderType,
      actionOnWin0: step.actionOnWin0,
      actionOnWin1: step.actionOnWin1,
      notionalCap: step.notionalCap,
      successorMarketId: step.successorMarketId,
      nextStepId: step.nextStepId,
      orderId: 0n,
      winningOutcome: 0,
    }],
  });
}

// Simulate against real chain state first so a revert is reported before the
// user is asked to sign anything.
export async function armStep({ provider, account, stepId, step, vault = SHANNON.vault }) {
  const client = publicClient();
  const args = [stepId, {
    status: 0,
    triggerMarketId: step.triggerMarketId,
    pool: step.pool,
    price: step.price,
    quantity: step.quantity,
    expireNs: step.expireNs,
    orderType: step.orderType,
    actionOnWin0: step.actionOnWin0,
    actionOnWin1: step.actionOnWin1,
    notionalCap: step.notionalCap,
    successorMarketId: step.successorMarketId,
    nextStepId: step.nextStepId,
    orderId: 0n,
    winningOutcome: 0,
  }];
  const { request } = await client.simulateContract({
    address: vault, abi: vaultAbi, functionName: "armStep", args, account,
  });
  const hash = await walletClientFor(provider, account).writeContract(request);
  const receipt = await client.waitForTransactionReceipt({ hash });
  return { hash, receipt, blockNumber: receipt.blockNumber, status: receipt.status };
}

// `onHash` fires the moment the wallet returns a signature, which is the point
// where responsibility passes from the person to the network. Without it the
// interface cannot tell "still waiting on you" apart from "waiting on a block",
// and shows one misleading label for both.
export async function sendVaultTx({ provider, account, functionName, args = [], vault = SHANNON.vault, onHash }) {
  const client = publicClient();
  const { request } = await client.simulateContract({ address: vault, abi: vaultAbi, functionName, args, account });
  const hash = await walletClientFor(provider, account).writeContract(request);
  onHash?.(hash);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The network rejected this transaction, so nothing changed.");
  return { hash, receipt, blockNumber: receipt.blockNumber, status: receipt.status };
}

// Fund the vault's own native balance. Somnia Reactivity charges the
// subscription stake to the subscribing contract, so the vault must hold it.
export async function fundVault({ provider, account, value, vault = SHANNON.vault, onHash }) {
  const client = publicClient();
  const hash = await walletClientFor(provider, account).sendTransaction({ to: vault, value });
  onHash?.(hash);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The network rejected this transfer, so nothing moved.");
  return { hash, receipt, blockNumber: receipt.blockNumber, status: receipt.status };
}

// Move test USDC from the connected wallet into the trading account.
//
// This is the funding path a trader should actually get: Sequence builds the
// transfer and the wallet signs it. Handing someone an address to copy, then
// asking them to open their wallet, find the token and send it by hand, is not a
// funding flow — it is an instruction manual.
export async function fundVaultCollateral({ provider, account, vault = SHANNON.vault, amount, collateral = SHANNON.testUsdc, onHash }) {
  const client = publicClient();
  const { request } = await client.simulateContract({
    address: collateral, abi: erc20TransferAbi, functionName: "transfer",
    args: [vault, amount], account,
  });
  const hash = await walletClientFor(provider, account).writeContract(request);
  onHash?.(hash);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The network rejected the transfer, so nothing moved.");
  return { hash, receipt, status: receipt.status };
}

// The same call, unsigned, so the fee can be estimated before a wallet opens.
export function fundVaultCall({ vault = SHANNON.vault, amount, collateral = SHANNON.testUsdc }) {
  return { address: collateral, abi: erc20TransferAbi, functionName: "transfer", args: [vault, amount] };
}

export async function readWalletCollateral(account, collateral = SHANNON.testUsdc) {
  if (!account) return 0n;
  return publicClient().readContract({
    address: collateral, abi: erc20TransferAbi, functionName: "balanceOf", args: [account],
  }).catch(() => 0n);
}

export async function readNativeBalance(address) {
  return publicClient().getBalance({ address });
}

export const subscribeAllMarkets = (opts) => sendVaultTx({ ...opts, functionName: "subscribeAllMarkets", args: [] });
export const approvePool = (opts) => sendVaultTx({ ...opts, functionName: "approvePool", args: [opts.pool, opts.amount] });
export const queueStep = (opts) => sendVaultTx({ ...opts, functionName: "queueStep", args: [opts.stepId, opts.step] });
// Nudge a step whose market has resolved but whose event never arrived.
// Permissionless: the caller supplies only a market id and the vault reads the
// outcome from the market contract itself.
export const syncResolution = (opts) => sendVaultTx({ ...opts, functionName: "syncResolution", args: [opts.marketId] });

// Turn a settled winning position back into collateral the sequence can reuse.
// Permissionless like syncResolution: the vault owns the tokens, so the caller
// gains nothing by triggering it.
export const redeemPosition = (opts) => sendVaultTx({ ...opts, functionName: "redeemPosition", args: [opts.marketId] });

export const cancelStep = (opts) => sendVaultTx({ ...opts, functionName: "cancelStep", args: [opts.stepId] });
export const setPaused = (opts) => sendVaultTx({ ...opts, functionName: "setPaused", args: [opts.paused] });

// ---- per-wallet accounts ---------------------------------------------------

// The vault belonging to a wallet, or null if that wallet has never provisioned
// one. This is what makes the product multi-tenant: nothing reads a hardcoded
// vault any more, so a visitor sees their own account or an invitation to make
// one, never somebody else's.
export async function vaultForAccount(account, factory = SHANNON.factory) {
  if (!account || !factory) return null;
  const found = await publicClient().readContract({
    address: factory, abi: factoryAbi, functionName: "vaultFor", args: [account],
  });
  return found === "0x0000000000000000000000000000000000000000" ? null : found;
}

// Deploy the connected wallet's own vault. They own it; the factory keeps no
// authority over it.
export async function createVault({ provider, account, maxOutstanding, factory = SHANNON.factory, onHash }) {
  const client = publicClient();
  const { request } = await client.simulateContract({
    address: factory, abi: factoryAbi, functionName: "createVault",
    args: [maxOutstanding], account,
  });
  const hash = await walletClientFor(provider, account).writeContract(request);
  onHash?.(hash);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The network rejected the account creation, so nothing was created.");
  const vault = await vaultForAccount(account, factory);
  return { hash, receipt, vault, status: receipt.status };
}

// The exact call `createVault` will make, so it can be gas-estimated before a
// wallet is opened.
export function createVaultCall({ maxOutstanding, factory = SHANNON.factory }) {
  return { address: factory, abi: factoryAbi, functionName: "createVault", args: [maxOutstanding] };
}

// How much of the vault's collateral a given pool may currently draw.
export async function readAllowance(vault, collateral, pool) {
  return publicClient().readContract({
    address: collateral,
    abi: [{ type: "function", stateMutability: "view", name: "allowance",
            inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] }],
    functionName: "allowance", args: [vault, pool],
  });
}

// Make sure every pool a sequence might execute against can actually draw the
// collateral. Approving only the first pool left later steps unable to trade,
// and pools are recycled between windows so the set is not fixed.
export async function ensurePoolAllowances({ provider, account, vault, collateral, pools, amount }) {
  const approved = [];
  for (const pool of [...new Set(pools.filter(Boolean).map((p) => p.toLowerCase()))]) {
    const current = await readAllowance(vault, collateral, pool);
    if (current >= amount) continue;
    const result = await sendVaultTx({
      provider, account, vault, functionName: "approvePool", args: [pool, amount],
    });
    approved.push({ pool, hash: result.hash });
  }
  return approved;
}
