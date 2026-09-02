#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
echo ">> writing vault client into $(pwd)/app/planner"

cat > app/planner/addresses.ts << 'TS'
export const SHANNON = {
  rpc: "https://dream-rpc.somnia.network",
  ws: "wss://dream-rpc.somnia.network/ws",
  chainId: 50312,
  indexer: "https://dev.smk.somnia.host/v1/graphql",
  oracleHub: "0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b",
  binaryModule: "0x3ecC694Cef705358864a646142ac17A90E29e388",
  testUsdc: "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E",
  vault: "0x998A0F8be4991C352142E4350346Ecf86886C9F8",
};
export const ANSWER_DELIVERED_TOPIC0 =
  "0x981074cb1e0ea7eac4cbc8c4c9ddbef8b964373e7e8cd0904c8e0951c4430541";
TS

cat > app/planner/vaultAbi.ts << 'TS'
export const vaultAbi = [
  { type: "function", stateMutability: "view", name: "owner", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", stateMutability: "view", name: "paused", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", stateMutability: "view", name: "subscriptionId", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", stateMutability: "view", name: "outstandingNotional", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", stateMutability: "view", name: "maxOutstandingNotional", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", stateMutability: "view", name: "stepStatus", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint8" }] },
  { type: "function", stateMutability: "nonpayable", name: "approvePool", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
  { type: "function", stateMutability: "nonpayable", name: "subscribeAllMarkets", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", stateMutability: "nonpayable", name: "setPaused", inputs: [{ type: "bool" }], outputs: [] },
  { type: "function", stateMutability: "nonpayable", name: "armStep",
    inputs: [
      { type: "bytes32", name: "stepId" },
      { type: "tuple", name: "s", components: [
        { type: "uint8", name: "status" },
        { type: "bytes32", name: "triggerMarketId" },
        { type: "address", name: "pool" },
        { type: "uint256", name: "price" },
        { type: "uint256", name: "quantity" },
        { type: "uint64", name: "expireNs" },
        { type: "uint8", name: "orderType" },
        { type: "bool", name: "buyYesOnWin0" },
        { type: "uint256", name: "notionalCap" },
        { type: "uint128", name: "orderId" },
        { type: "uint8", name: "winningOutcome" },
      ] },
    ],
    outputs: [] },
  { type: "event", name: "Executed", inputs: [
    { type: "bytes32", name: "stepId", indexed: true },
    { type: "address", name: "pool", indexed: true },
    { type: "uint8", name: "kind" },
    { type: "bool", name: "success" },
    { type: "uint128", name: "orderId" },
    { type: "uint256", name: "notional" },
  ] },
  { type: "event", name: "Triggered", inputs: [
    { type: "bytes32", name: "stepId", indexed: true },
    { type: "bytes32", name: "marketId", indexed: true },
    { type: "uint256", name: "questionId" },
    { type: "bool", name: "voided" },
    { type: "uint8", name: "winningOutcome" },
  ] },
  { type: "event", name: "Skipped", inputs: [
    { type: "bytes32", name: "stepId", indexed: true },
    { type: "bytes32", name: "marketId", indexed: true },
    { type: "string", name: "reason" },
  ] },
] as const;
export const STATUS = ["NONE","ARMED","WAITING","TRIGGERED","EXECUTED","SKIPPED","EXPIRED","CANCELLED"] as const;
TS

cat > app/planner/vaultClient.ts << 'TS'
import { createPublicClient, http, encodeFunctionData, keccak256, toHex, type Address } from "viem";
import { SHANNON } from "./addresses.js";
import { vaultAbi, STATUS } from "./vaultAbi.js";

export function publicClient() {
  return createPublicClient({ transport: http(SHANNON.rpc) });
}
export async function readVault(vault: Address = SHANNON.vault as Address) {
  const c = publicClient();
  const [owner, paused, subId, outstanding, maxOut] = await Promise.all([
    c.readContract({ address: vault, abi: vaultAbi, functionName: "owner" }),
    c.readContract({ address: vault, abi: vaultAbi, functionName: "paused" }),
    c.readContract({ address: vault, abi: vaultAbi, functionName: "subscriptionId" }),
    c.readContract({ address: vault, abi: vaultAbi, functionName: "outstandingNotional" }),
    c.readContract({ address: vault, abi: vaultAbi, functionName: "maxOutstandingNotional" }),
  ]);
  return { owner, paused, subscriptionId: subId, outstanding, maxOutstanding: maxOut };
}
export function stepId(name: string): `0x${string}` { return keccak256(toHex(name)); }
export function buildArmCalldata(id: `0x${string}`, step: {
  triggerMarketId: `0x${string}`; pool: Address; price: bigint; quantity: bigint;
  expireNs: bigint; orderType: number; buyYesOnWin0: boolean; notionalCap: bigint;
}) {
  return encodeFunctionData({
    abi: vaultAbi, functionName: "armStep",
    args: [id, {
      status: 0, triggerMarketId: step.triggerMarketId, pool: step.pool,
      price: step.price, quantity: step.quantity, expireNs: step.expireNs,
      orderType: step.orderType, buyYesOnWin0: step.buyYesOnWin0, notionalCap: step.notionalCap,
      orderId: 0n, winningOutcome: 0,
    }],
  });
}
export async function readStepStatus(id: `0x${string}`, vault: Address = SHANNON.vault as Address) {
  const c = publicClient();
  const s = await c.readContract({ address: vault, abi: vaultAbi, functionName: "stepStatus", args: [id] });
  return STATUS[Number(s)];
}
TS

cat > app/planner/live.test.ts << 'TS'
import assert from "node:assert";
import { test } from "node:test";
import { readVault, stepId, buildArmCalldata } from "./vaultClient.js";
import { SHANNON } from "./addresses.js";

test("reads deployed vault state on Shannon", async () => {
  const v = await readVault();
  assert.ok(v.owner && v.owner.length === 42);
  assert.equal(typeof v.paused, "boolean");
  console.log("  owner:", v.owner, "| paused:", v.paused, "| subId:", v.subscriptionId.toString());
  console.log("  outstanding:", v.outstanding.toString(), "/ max:", v.maxOutstanding.toString());
});
test("stepId deterministic", () => {
  assert.equal(stepId("step1"), stepId("step1"));
  assert.equal(stepId("step1").length, 66);
});
test("armStep calldata encodes", () => {
  const d = buildArmCalldata(stepId("step1"), {
    triggerMarketId: ("0x" + "00".repeat(32)) as `0x${string}`,
    pool: SHANNON.binaryModule as `0x${string}`,
    price: 600000n, quantity: 5n, expireNs: 1000000000n, orderType: 2,
    buyYesOnWin0: true, notionalCap: 4000000n,
  });
  assert.ok(d.startsWith("0x") && d.length > 10);
  console.log("  calldata len:", d.length);
});
TS

npm --prefix app install viem >/dev/null 2>&1 && echo "viem installed."
node -e "const fs=require('fs');const p=require('./app/package.json');p.scripts=p.scripts||{};p.scripts['test:live']='tsx --test planner/live.test.ts';fs.writeFileSync('./app/package.json',JSON.stringify(p,null,2));"

echo ""
echo ">> live read-only test against deployed vault"
npm --prefix app exec tsx -- --test planner/live.test.ts
