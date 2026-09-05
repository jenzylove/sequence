// Can one funded subscription owner drive several different handlers?
//
// Somnia's model separates the subscription OWNER, which must hold 32 STT, from
// the HANDLER contract it invokes. If that separation is real, Sequence can pay
// for delivery once and every user's own vault can be a handler — and no trader
// ever has to find 32 STT to have their sequence run by itself.
//
// The spike is deliberately built to fail loudly if the minimum is per
// subscription rather than per owner: the manager is funded with more than 32
// and less than 64, then asked for two subscriptions with two different
// handlers. If Somnia wanted 32 each, the second call cannot succeed.
import { createWalletClient, createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHANNON, shannonChain, txUrl } from "../src/chain/config.js";
import { factoryAbi } from "../src/chain/factoryAbi.js";

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
const stt = (w) => `${(Number(w) / 1e18).toFixed(2)} STT`;
const findings = [];
const note = (label, detail, tx) => {
  findings.push({ check: label, detail, tx: tx || null });
  say(`  ${label}: ${detail}`);
  if (tx) say(`     ${txUrl(tx)}`);
};

const PRECOMPILE = "0x0000000000000000000000000000000000000100";
const SUB_TUPLE = {
  type: "tuple",
  components: [
    { name: "eventTopics", type: "bytes32[4]" }, { name: "origin", type: "address" },
    { name: "caller", type: "address" }, { name: "emitter", type: "address" },
    { name: "handlerContractAddress", type: "address" }, { name: "handlerFunctionSelector", type: "bytes4" },
    { name: "priorityFeePerGas", type: "uint64" }, { name: "maxFeePerGas", type: "uint64" },
    { name: "gasLimit", type: "uint64" }, { name: "isGuaranteed", type: "bool" }, { name: "isCoalesced", type: "bool" },
  ],
};
const precompileAbi = [{
  type: "function", stateMutability: "view", name: "getSubscriptionInfo",
  inputs: [{ name: "subscriptionId", type: "uint256" }],
  outputs: [{ ...SUB_TUPLE, name: "subscriptionData" }, { name: "owner", type: "address" }],
}];

const managerArtifact = JSON.parse(readFileSync(join(repo, "out/SequenceSubscriptionManager.sol/SequenceSubscriptionManager.json"), "utf8"));
const managerAbi = managerArtifact.abi;

const send = async (wallet, params) => {
  const { request } = await pub.simulateContract(params);
  const hash = await wallet.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`reverted: ${hash}`);
  return hash;
};

// ---- 1. deploy the manager, funded above 32 and below 64 --------------------
const STAKE = 35n * 10n ** 18n;   // deliberately not 64
let manager;
{
  const hash = await funderWallet.deployContract({
    abi: managerAbi, bytecode: managerArtifact.bytecode.object,
    args: [funder.address], value: STAKE,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  manager = receipt.contractAddress;
  const bal = await pub.getBalance({ address: manager });
  note("manager deployed", `${manager} holding ${stt(bal)} — above the 32 STT minimum, far below 2x it`, hash);
}

// ---- 2. two genuinely different users, each with their own vault ------------
const users = [];
for (const label of ["A", "B"]) {
  const key = generatePrivateKey();
  const acct = privateKeyToAccount(key);
  const wallet = createWalletClient({ account: acct, chain: shannonChain, transport: http(SHANNON.rpc) });
  const h = await funderWallet.sendTransaction({ to: acct.address, value: 2n * 10n ** 18n });
  await pub.waitForTransactionReceipt({ hash: h });
  await send(wallet, {
    address: SHANNON.factory, abi: factoryAbi, functionName: "createVault",
    args: [5000000n], account: acct,
  });
  const vault = await pub.readContract({
    address: SHANNON.factory, abi: factoryAbi, functionName: "vaultFor", args: [acct.address],
  });
  users.push({ label, key, acct, wallet, vault });
  const bal = await pub.getBalance({ address: acct.address });
  note(`user ${label}`, `wallet ${acct.address} owns vault ${vault}, holding ${stt(bal)} — nowhere near a 32 STT stake`);
}

// ---- 3. register both, from one shared stake --------------------------------
// Two different markets, so each subscription is exact rather than a wildcard.
const MARKET_A = "0x" + "00".repeat(29) + "0140a1";
const MARKET_B = "0x" + "00".repeat(29) + "0140a2";
const ids = {};
for (const [i, u] of users.entries()) {
  const market = i === 0 ? MARKET_A : MARKET_B;
  const hash = await send(u.wallet, {
    address: manager, abi: managerAbi, functionName: "register",
    args: [u.vault, market], account: u.acct,
  });
  ids[u.label] = { market, hash };
  note(`registered ${u.label}`, `vault ${u.vault} for market ${market.slice(-6)}, paid for by the shared stake`, hash);
}

// Read the ids back off the manager's own mapping.
const { keccak256, encodePacked } = await import("viem");
for (const [i, u] of users.entries()) {
  const market = i === 0 ? MARKET_A : MARKET_B;
  const key = keccak256(encodePacked(["address", "bytes32"], [u.vault, market]));
  ids[u.label].id = await pub.readContract({
    address: manager, abi: managerAbi, functionName: "subscriptionOf", args: [key],
  });
}

// ---- 4. the proof: one owner, one stake, two handlers -----------------------
const checks = [];
for (const u of users) {
  const [data, owner] = await pub.readContract({
    address: PRECOMPILE, abi: precompileAbi, functionName: "getSubscriptionInfo", args: [ids[u.label].id],
  });
  checks.push([
    `subscription ${ids[u.label].id} is owned by the manager`,
    owner.toLowerCase() === manager.toLowerCase(), owner,
  ]);
  checks.push([
    `subscription ${ids[u.label].id} hands off to user ${u.label}'s own vault`,
    data.handlerContractAddress.toLowerCase() === u.vault.toLowerCase(), data.handlerContractAddress,
  ]);
  checks.push([
    `subscription ${ids[u.label].id} filters on exactly one market`,
    data.eventTopics[2].toLowerCase() === ids[u.label].market.toLowerCase(), data.eventTopics[2],
  ]);
}
const finalBalance = await pub.getBalance({ address: manager });
const live = await pub.readContract({ address: manager, abi: managerAbi, functionName: "liveSubscriptions" });
checks.push(["both subscriptions are live at once", live === 2n, live.toString()]);
checks.push([
  "the shared owner never held 2x the minimum",
  finalBalance < 64n * 10n ** 18n && finalBalance >= 32n * 10n ** 18n, stt(finalBalance),
]);
for (const u of users) {
  const bal = await pub.getBalance({ address: u.acct.address });
  checks.push([`user ${u.label} never staked anything`, bal < 32n * 10n ** 18n, stt(bal)]);
}

say("");
let bad = 0;
for (const [label, pass, detail] of checks) {
  say(`  ${pass ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  if (!pass) bad++;
}

writeFileSync(join(repo, "docs", "SHARED_REACTIVITY.json"), JSON.stringify({
  question: "Can one funded subscription owner drive several different handler contracts, so users never stake?",
  answer: bad === 0
    ? "Yes. The 32 STT minimum is checked against the owner's balance, not per subscription, and the handler is an independent field. One manager holding 35 STT owns two live subscriptions pointing at two different users' vaults."
    : "Not established; see the failing checks.",
  manager,
  managerStake: finalBalance.toString(),
  liveSubscriptions: live.toString(),
  users: users.map((u, i) => ({
    label: u.label, wallet: u.acct.address, vault: u.vault,
    market: i === 0 ? MARKET_A : MARKET_B,
    subscriptionId: ids[u.label].id.toString(),
    registerTx: ids[u.label].hash,
  })),
  checks: checks.map(([check, pass, detail]) => ({ check, pass, detail: String(detail) })),
  findings,
  spikedAt: new Date().toISOString(),
}, null, 2) + "\n");

writeFileSync(join(repo, "docs", "SPIKE_KEYS.txt"),
  users.map((u) => `${u.label} ${u.acct.address} ${u.key} ${u.vault}`).join("\n") + `\nMANAGER ${manager}\n`);

say(`\n${bad === 0 ? "SHARED OWNERSHIP WORKS" : `${bad} check(s) failed`} — docs/SHARED_REACTIVITY.json`);
process.exit(bad === 0 ? 0 : 1);
