// Deploy the production-shaped Sequence Reactivity manager to Somnia Shannon.
//
// This is NOT a probe. It deploys the exact manager compiled from src/, funds it
// with one shared 35 STT owner balance, and records public deployment evidence.
// It never prints or writes PRIVATE_KEY.
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SHANNON, shannonChain, txUrl, addressUrl } from "../src/chain/config.js";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const env = Object.fromEntries(
  readFileSync(join(repo, ".env"), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
if (!/^0x[0-9a-fA-F]{64}$/.test(env.PRIVATE_KEY || "")) throw new Error("PRIVATE_KEY missing/invalid in repo .env");

const account = privateKeyToAccount(env.PRIVATE_KEY);
const pub = createPublicClient({ chain: shannonChain, transport: http(env.RPC_URL || SHANNON.rpc) });
const wallet = createWalletClient({ account, chain: shannonChain, transport: http(env.RPC_URL || SHANNON.rpc) });
const artifact = JSON.parse(readFileSync(join(repo, "out/SequenceSubscriptionManager.sol/SequenceSubscriptionManager.json"), "utf8"));
const abi = artifact.abi;
const STAKE = 35n * 10n ** 18n;

const before = await pub.getBalance({ address: account.address });
if (before < STAKE + 2n * 10n ** 17n) {
  throw new Error(`deployer has ${(Number(before) / 1e18).toFixed(2)} STT; need at least 35.20 STT for stake + deployment gas`);
}
const factoryCode = await pub.getBytecode({ address: SHANNON.factory });
if (!factoryCode || factoryCode === "0x") throw new Error(`configured factory has no code: ${SHANNON.factory}`);

console.log(`deployer ${account.address}`);
console.log(`factory  ${SHANNON.factory}`);
console.log(`stake    35.00 STT`);
console.log("broadcasting shared-manager deployment...");

const hash = await wallet.deployContract({
  abi,
  bytecode: artifact.bytecode.object,
  args: [account.address, SHANNON.factory],
  value: STAKE,
});
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`manager deployment failed: ${hash}`);
const manager = receipt.contractAddress;

const [operator, factory, stake, live, code] = await Promise.all([
  pub.readContract({ address: manager, abi, functionName: "operator" }),
  pub.readContract({ address: manager, abi, functionName: "factory" }),
  pub.readContract({ address: manager, abi, functionName: "stake" }),
  pub.readContract({ address: manager, abi, functionName: "liveSubscriptions" }),
  pub.getBytecode({ address: manager }),
]);
const checks = [
  ["deployed bytecode exists", Boolean(code && code !== "0x"), code ? `${(code.length - 2) / 2} bytes` : "none"],
  ["operator is project wallet", operator.toLowerCase() === account.address.toLowerCase(), operator],
  ["manager is bound to canonical factory", factory.toLowerCase() === SHANNON.factory.toLowerCase(), factory],
  ["one shared stake is funded", stake >= 32n * 10n ** 18n && stake < 64n * 10n ** 18n, `${(Number(stake) / 1e18).toFixed(2)} STT`],
  ["manager starts with zero subscriptions", live === 0n, live.toString()],
];
let bad = 0;
for (const [name, pass, detail] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${name} — ${detail}`);
  if (!pass) bad++;
}

const evidence = {
  purpose: "Production-shaped shared Reactivity manager deployment",
  manager,
  operator,
  factory,
  stake: stake.toString(),
  liveSubscriptions: live.toString(),
  deployTx: hash,
  deployBlock: receipt.blockNumber.toString(),
  checks: checks.map(([check, pass, detail]) => ({ check, pass, detail: String(detail) })),
  deployedAt: new Date().toISOString(),
};
writeFileSync(join(repo, "docs", "SHARED_MANAGER_DEPLOYMENT.json"), JSON.stringify(evidence, null, 2) + "\n");

console.log(`\nmanager ${manager}`);
console.log(addressUrl(manager));
console.log(txUrl(hash));
console.log(`NEXT_MANAGER_ADDRESS=${manager}`);
console.log("evidence: docs/SHARED_MANAGER_DEPLOYMENT.json");
if (bad) process.exit(1);
