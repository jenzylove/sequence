import assert from "node:assert";
import { test } from "node:test";
import { readVault, stepId, buildArmCalldata } from "./vaultClient.js";
import { SHANNON } from "./addresses.js";
import { fetchRecentResolutions, fetchOpenMarkets, toResolutions } from "./fetchResolutions.js";
import { simulate } from "./simulate.js";
import { validate } from "./model.js";

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

test("fetches real settled markets from the Somnia indexer", async () => {
  const rows = await fetchRecentResolutions(10);
  assert.ok(rows.length > 0, "indexer returned no settled binary markets");
  const r = rows[0];
  assert.match(r.marketId, /^0x[0-9a-f]{64}$/i);
  assert.ok(r.payoutNumerators && r.payoutNumerators.length > 0);
  console.log("  newest settled:", r.asset, r.question?.slice(0, 48), "payouts", r.payoutNumerators);
});

test("fetches live open markets with real pools", async () => {
  const rows = await fetchOpenMarkets(20);
  assert.ok(rows.length > 0, "indexer returned no open binary markets");
  assert.match(rows[0].binaryPoolAddress!, /^0x[0-9a-f]{40}$/i);
  console.log("  open markets:", rows.length, "| soonest pool:", rows[0].binaryPoolAddress);
});

test("simulation over real resolutions respects the vault cap", async () => {
  const rows = await fetchRecentResolutions(10);
  const resolutions = toResolutions(rows);
  const steps: Record<string, any> = {};
  rows.slice(0, 3).forEach((r, i) => {
    steps[`s${i}`] = {
      id: `s${i}`, triggerMarketId: r.marketId, pool: r.binaryPoolAddress ?? SHANNON.binaryModule,
      price: 600000n, quantity: 5n, orderType: 2, buyYesOnWin0: true, notionalCap: 4_000000n,
    };
  });
  const strat = { name: "live", entryStepId: "s0", steps, bankroll: 10_000000n, maxOutstanding: 5_000000n };
  assert.deepEqual(validate(strat as any), []);
  const result = simulate(strat as any, resolutions);
  assert.ok(result.committedNotional <= strat.maxOutstanding, "simulation committed beyond the vault cap");
  console.log("  events:", result.events.length, "| committed:", result.committedNotional.toString());
});
