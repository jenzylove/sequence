// What a finished sequence did to your money.
//
// The Finished tab showed a status word and nothing else — it told you the rule
// ran, never what it made. These pin the arithmetic against the shapes the vault
// actually emits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resultFor, totalResult, statusCopy } from "./lib/language.js";

const MARKET = `0x${"ab".repeat(32)}`;
const step = (over = {}) => ({
  stepId: `0x${"11".repeat(32)}`, statusLabel: "PLACED", successorMarketId: MARKET, ...over,
});
const placed = (stepId, notional) => ({ name: "Placed", args: { stepId, notional } });
const redeemed = (marketId, collateral) => ({ name: "Redeemed", args: { marketId, collateral } });

test("a winning trade reports what went in, what came back, and the difference", () => {
  const s = step();
  const r = resultFor(s, [placed(s.stepId, 2_000000n), redeemed(MARKET, 4_366000n)]);
  assert.equal(r.kind, "settled");
  assert.equal(r.spent, 2_000000n);
  assert.equal(r.returned, 4_366000n);
  assert.equal(r.net, 2_366000n, "the trader made $2.366");
});

test("a losing trade reports a negative result rather than hiding it", () => {
  const s = step();
  const r = resultFor(s, [placed(s.stepId, 2_000000n), redeemed(MARKET, 0n)]);
  assert.equal(r.net, -2_000000n);
});

test("a placed trade whose market has not settled is open, not zero", () => {
  const s = step();
  const r = resultFor(s, [placed(s.stepId, 2_000000n)]);
  assert.equal(r.kind, "open");
  assert.equal(r.spent, 2_000000n);
});

test("a skipped sequence says nothing was risked", () => {
  const r = resultFor(step({ statusLabel: "SKIPPED" }), []);
  assert.equal(r.kind, "no-trade");
  assert.equal(r.spent, 0n);
});

test("redemption is matched on the market the position is held in", () => {
  // The step watches one market and holds tokens in another. Matching on the
  // trigger would report every winning trade as unsettled.
  const s = step({ triggerMarketId: `0x${"cd".repeat(32)}` });
  const r = resultFor(s, [placed(s.stepId, 1_000000n), redeemed(MARKET, 1_500000n)]);
  assert.equal(r.kind, "settled");
  assert.equal(r.net, 500000n);
});

test("the total only counts sequences that actually settled", () => {
  const a = step({ stepId: "0xaa" });
  const b = step({ stepId: "0xbb", statusLabel: "SKIPPED" });
  const c = step({ stepId: "0xcc" });
  const events = [
    placed("0xaa", 2_000000n), redeemed(MARKET, 3_000000n),
    placed("0xcc", 1_000000n),                                  // still open
  ];
  const t = totalResult([a, b, c], events);
  assert.equal(t.settled, 1, "only the settled one counts");
  assert.equal(t.net, 1_000000n);
});

test("a skipped sequence is called a no trade, not 'stood down'", () => {
  assert.equal(statusCopy("SKIPPED").label, "No trade");
});
