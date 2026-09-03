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
  expireNs: bigint; orderType: number; actionOnWin0: number; actionOnWin1: number; notionalCap: bigint;
}) {
  return encodeFunctionData({
    abi: vaultAbi, functionName: "armStep",
    args: [id, {
      status: 0, triggerMarketId: step.triggerMarketId, pool: step.pool,
      price: step.price, quantity: step.quantity, expireNs: step.expireNs,
      orderType: step.orderType, actionOnWin0: step.actionOnWin0, actionOnWin1: step.actionOnWin1,
      notionalCap: step.notionalCap,
      orderId: 0n, winningOutcome: 0,
    }],
  });
}
export async function readStepStatus(id: `0x${string}`, vault: Address = SHANNON.vault as Address) {
  const c = publicClient();
  const s = await c.readContract({ address: vault, abi: vaultAbi, functionName: "stepStatus", args: [id] });
  return STATUS[Number(s)];
}
