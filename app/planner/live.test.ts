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
