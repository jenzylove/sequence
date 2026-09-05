// Tests the one Reactivity path we had never tried: a subscription with
// isGuaranteed = true, owned by a funded EOA, pointing at the already-deployed
// SequenceVault.
//
// Every subscription Sequence created for itself had isGuaranteed false, because
// neither SomniaExtensions' Solidity options struct nor the TypeScript SDK's
// friendly subscribe() exposes the flag - both hardcode it to false. Only the
// precompile's raw subscribe takes it. So this uses subscribeRaw, changes
// nothing about the vault, and costs no redeploy.
//
//   node scripts/reactivity-guaranteed.mjs create   # subscribe and prove the record
//   node scripts/reactivity-guaranteed.mjs status   # read it back
import { createWalletClient, createPublicClient, http, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHANNON, shannonChain, txUrl } from "../src/chain/config.js";
import { Verified } from "./verified-constants.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const evidencePath = join(repo, "docs", "REACTIVITY_EXPERIMENT.json");

const env = Object.fromEntries(
  readFileSync(join(repo, ".env"), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const PRECOMPILE = "0x0000000000000000000000000000000000000100";
const account = privateKeyToAccount(env.PRIVATE_KEY);
const pub = createPublicClient({ chain: shannonChain, transport: http(SHANNON.rpc) });
const wallet = createWalletClient({ account, chain: shannonChain, transport: http(SHANNON.rpc) });

const SUB_TUPLE = {
  type: "tuple",
  components: [
    { name: "eventTopics", type: "bytes32[4]" },
    { name: "origin", type: "address" },
    { name: "caller", type: "address" },
    { name: "emitter", type: "address" },
    { name: "handlerContractAddress", type: "address" },
    { name: "handlerFunctionSelector", type: "bytes4" },
    { name: "priorityFeePerGas", type: "uint64" },
    { name: "maxFeePerGas", type: "uint64" },
    { name: "gasLimit", type: "uint64" },
    { name: "isGuaranteed", type: "bool" },
    { name: "isCoalesced", type: "bool" },
  ],
};
const precompileAbi = [
  { type: "function", stateMutability: "nonpayable", name: "subscribe",
    inputs: [{ ...SUB_TUPLE, name: "subscriptionData" }],
    outputs: [{ name: "subscriptionId", type: "uint256" }] },
  { type: "function", stateMutability: "view", name: "getSubscriptionInfo",
    inputs: [{ name: "subscriptionId", type: "uint256" }],
    outputs: [{ ...SUB_TUPLE, name: "subscriptionData" }, { name: "owner", type: "address" }] },
  { type: "function", stateMutability: "nonpayable", name: "unsubscribe",
    inputs: [{ name: "subscriptionId", type: "uint256" }], outputs: [] },
  { type: "event", name: "SubscriptionCreated", inputs: [
    { name: "subscriptionId", type: "uint256", indexed: true },
    { name: "owner", type: "address", indexed: true },
    { ...SUB_TUPLE, name: "subscriptionData", indexed: false },
  ] },
];

const ZERO32 = `0x${"00".repeat(32)}`;
const ZERO = "0x0000000000000000000000000000000000000000";
// SomniaEventHandler.onEvent(address,bytes32[],bytes)
const ON_EVENT_SELECTOR = "0x53edf33d";

const say = (...a) => console.log(...a);
const load = () => (existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, "utf8")) : {});
const save = (d) => writeFileSync(evidencePath, JSON.stringify(d, null, 2) + "\n");

async function readBack(id) {
  const [data, owner] = await pub.readContract({
    address: PRECOMPILE, abi: precompileAbi, functionName: "getSubscriptionInfo", args: [BigInt(id)],
  });
  return { data, owner };
}

async function create() {
  const handler = SHANNON.vault;
  const balance = await pub.getBalance({ address: account.address });
  const MIN = 32n * 10n ** 18n;
  say(`subscriber (EOA) ${account.address}`);
  say(`balance          ${Number(balance) / 1e18} SOM (minimum ${Number(MIN) / 1e18})`);
  if (balance < MIN) throw new Error("the subscribing EOA is below the 32 SOM owner minimum");
  say(`handler          ${handler}`);
  say(`emitter          ${Verified.ORACLE_HUB}`);
  say(`topic0           ${Verified.ANSWER_DELIVERED_TOPIC0}\n`);

  const subscription = {
    eventTopics: [Verified.ANSWER_DELIVERED_TOPIC0, ZERO32, ZERO32, ZERO32],
    origin: ZERO,
    caller: ZERO,
    emitter: Verified.ORACLE_HUB,
    handlerContractAddress: handler,
    handlerFunctionSelector: ON_EVENT_SELECTOR,
    priorityFeePerGas: 2000000000n,   // 2 gwei
    maxFeePerGas: 60000000000n,       // 60 gwei, above the documented safe floor
    gasLimit: 10000000n,
    isGuaranteed: true,               // the thing that has never been tried
    isCoalesced: false,
  };

  const { request } = await pub.simulateContract({
    address: PRECOMPILE, abi: precompileAbi, functionName: "subscribe",
    args: [subscription], account,
  });
  const hash = await wallet.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  say(`subscribe tx ${receipt.status}  ${txUrl(hash)}`);

  const created = parseEventLogs({ abi: precompileAbi, logs: receipt.logs })
    .find((e) => e.eventName === "SubscriptionCreated");
  const id = created?.args?.subscriptionId;
  if (!id) throw new Error("no SubscriptionCreated event in the receipt");
  say(`subscription id ${id}\n`);

  const { data, owner } = await readBack(id);
  const checks = [
    ["owner is the subscribing EOA, not zero", owner.toLowerCase() === account.address.toLowerCase(), owner],
    ["handler is SequenceVault", data.handlerContractAddress.toLowerCase() === handler.toLowerCase(), data.handlerContractAddress],
    ["emitter is OracleHub", data.emitter.toLowerCase() === Verified.ORACLE_HUB.toLowerCase(), data.emitter],
    ["topic0 is AnswerDelivered", data.eventTopics[0].toLowerCase() === Verified.ANSWER_DELIVERED_TOPIC0.toLowerCase(), data.eventTopics[0]],
    ["other topics are wildcard", data.eventTopics.slice(1).every((t) => t === ZERO32), "0x0 x3"],
    ["handler selector is onEvent", data.handlerFunctionSelector.toLowerCase() === ON_EVENT_SELECTOR, data.handlerFunctionSelector],
    ["isGuaranteed is TRUE", data.isGuaranteed === true, String(data.isGuaranteed)],
    ["isCoalesced is false", data.isCoalesced === false, String(data.isCoalesced)],
    ["gas limit is 10,000,000", data.gasLimit === 10000000n, data.gasLimit.toString()],
    ["priority fee is 2 gwei", data.priorityFeePerGas === 2000000000n, data.priorityFeePerGas.toString()],
    ["owner balance meets the minimum", balance >= MIN, `${Number(balance) / 1e18} SOM`],
  ];
  let bad = 0;
  for (const [label, pass, detail] of checks) {
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${label} — ${detail}`);
    if (!pass) bad++;
  }

  const evidence = {
    note: "A guaranteed subscription owned by an EOA, pointing at the already-deployed SequenceVault. No contract change.",
    subscriptionId: id.toString(),
    owner,
    handler,
    emitter: data.emitter,
    topic0: data.eventTopics[0],
    handlerFunctionSelector: data.handlerFunctionSelector,
    priorityFeePerGas: data.priorityFeePerGas.toString(),
    maxFeePerGas: data.maxFeePerGas.toString(),
    gasLimit: data.gasLimit.toString(),
    isGuaranteed: data.isGuaranteed,
    isCoalesced: data.isCoalesced,
    ownerBalanceWei: balance.toString(),
    subscribeTx: hash,
    createdAt: new Date().toISOString(),
    checksFailed: bad,
    contrast: "Sequence's own subscriptions were created through SomniaExtensions (Solidity) and the SDK's subscribe(); both hardcode isGuaranteed to false and are owned by the vault contract. This one is EOA-owned with isGuaranteed true.",
  };
  save({ ...load(), subscription: evidence });
  say(`\nevidence written to docs/REACTIVITY_EXPERIMENT.json`);
  return id;
}

async function status() {
  const e = load().subscription;
  if (!e) throw new Error("no subscription recorded yet; run with `create` first");
  const { data, owner } = await readBack(e.subscriptionId);
  say(`subscription ${e.subscriptionId}`);
  say(`  owner        ${owner}`);
  say(`  handler      ${data.handlerContractAddress}`);
  say(`  isGuaranteed ${data.isGuaranteed}`);
  say(`  balance      ${Number(await pub.getBalance({ address: owner })) / 1e18} SOM`);
}

const mode = process.argv[2] || "create";
if (mode === "create") await create();
else await status();
process.exit(0);
