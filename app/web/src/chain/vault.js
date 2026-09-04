// Real SequenceVault access. Reads go through a viem public client against the
// Shannon RPC; writes go through the user's own injected wallet, so every state
// change is a transaction the user signs. Nothing here returns a placeholder:
// a failed read surfaces as an error, never as an invented number.
import { createPublicClient, createWalletClient, custom, http, encodeFunctionData, keccak256, toHex, parseEventLogs } from "viem";
import { SHANNON, shannonChain } from "./config.js";
import { vaultAbi } from "./abi.js";
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

export async function sendVaultTx({ provider, account, functionName, args = [], vault = SHANNON.vault }) {
  const client = publicClient();
  const { request } = await client.simulateContract({ address: vault, abi: vaultAbi, functionName, args, account });
  const hash = await walletClientFor(provider, account).writeContract(request);
  const receipt = await client.waitForTransactionReceipt({ hash });
  return { hash, receipt, blockNumber: receipt.blockNumber, status: receipt.status };
}

// Fund the vault's own native balance. Somnia Reactivity charges the
// subscription stake to the subscribing contract, so the vault must hold it.
export async function fundVault({ provider, account, value, vault = SHANNON.vault }) {
  const client = publicClient();
  const hash = await walletClientFor(provider, account).sendTransaction({ to: vault, value });
  const receipt = await client.waitForTransactionReceipt({ hash });
  return { hash, receipt, blockNumber: receipt.blockNumber, status: receipt.status };
}

export async function readNativeBalance(address) {
  return publicClient().getBalance({ address });
}

export const subscribeAllMarkets = (opts) => sendVaultTx({ ...opts, functionName: "subscribeAllMarkets", args: [] });
export const approvePool = (opts) => sendVaultTx({ ...opts, functionName: "approvePool", args: [opts.pool, opts.amount] });
export const queueStep = (opts) => sendVaultTx({ ...opts, functionName: "queueStep", args: [opts.stepId, opts.step] });
export const cancelStep = (opts) => sendVaultTx({ ...opts, functionName: "cancelStep", args: [opts.stepId] });
export const setPaused = (opts) => sendVaultTx({ ...opts, functionName: "setPaused", args: [opts.paused] });
