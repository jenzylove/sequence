// Pins what a typed budget turns into.
//
// The regression these exist for: the builder used to compute
// `quantity = budget / price`, which is right only if a quantity is a whole
// contract. Quantities are 6dp base units, so $2 at $0.50 is 4_000_000, not 4,
// and 4 is below every pool's minimum and reverts.
import test from "node:test";
import assert from "node:assert/strict";
import { sizeOrder, orderCost, DEFAULT_POOL_PARAMS, PRICE_SCALE } from "./chain/markets.js";

const SHANNON_POOL = { tickSize: 1000n, minQuantity: 1000n, lotSize: 1000n };
const usd = (raw) => Number(raw) / 1e6;

test("$2 at $0.50 buys 4.0 contracts, not 4 units", () => {
  const sized = sizeOrder({ price: 500000n, budget: 2000000n, ...SHANNON_POOL });
  assert.equal(sized.quantity, 4000000n);
  assert.equal(sized.price, 500000n);
  assert.equal(sized.cost, 2000000n);
  assert.equal(usd(sized.cost), 2);
});

test("the old arithmetic would have produced an unplaceable order", () => {
  const naive = 2000000n / 500000n;            // what the builder used to do
  assert.equal(naive, 4n);
  assert.ok(naive < SHANNON_POOL.minQuantity); // the pool reverts on this
});

test("a non-round price still lands on a tick and inside the budget", () => {
  // $0.4137 is not on a 0.001 tick; a buy must round UP to keep crossing.
  const sized = sizeOrder({ price: 413700n, budget: 2000000n, ...SHANNON_POOL });
  assert.equal(sized.price % SHANNON_POOL.tickSize, 0n);
  assert.equal(sized.price, 414000n);
  assert.equal(sized.quantity % SHANNON_POOL.lotSize, 0n);
  assert.ok(sized.cost <= 2000000n, `cost ${sized.cost} must not exceed the budget`);
  assert.equal(sized.cost, orderCost(sized.price, sized.quantity));
});

test("a budget is never exceeded, at any price", () => {
  for (const price of [1000n, 12000n, 333000n, 500000n, 807000n, 999000n]) {
    const sized = sizeOrder({ price, budget: 2000000n, ...SHANNON_POOL });
    if (!sized) continue;
    assert.ok(sized.cost <= 2000000n, `price ${price} produced ${sized.cost}`);
    assert.ok(sized.quantity >= SHANNON_POOL.minQuantity);
    assert.equal(sized.quantity % SHANNON_POOL.lotSize, 0n);
  }
});

test("a budget that buys less than one lot still returns a placeable minimum", () => {
  // One minimum lot at $0.50 costs 500000 * 1000 / 1e6 = 500 raw, i.e. $0.0005.
  const sized = sizeOrder({ price: 500000n, budget: 600n, ...SHANNON_POOL });
  assert.equal(sized.quantity, SHANNON_POOL.minQuantity);
  assert.ok(sized.cost <= 600n);
});

test("an amount too small for even one lot is refused, not rounded up", () => {
  // A budget below the cost of a single minimum lot cannot be an order.
  const sized = sizeOrder({ price: 500000n, budget: 100n, ...SHANNON_POOL });
  assert.equal(sized, null);
});

test("a coarse pool is respected rather than ignored", () => {
  const coarse = { tickSize: 10000n, minQuantity: 1000000n, lotSize: 1000000n };
  const sized = sizeOrder({ price: 505000n, budget: 2000000n, ...coarse });
  assert.equal(sized.price % coarse.tickSize, 0n);
  assert.equal(sized.quantity % coarse.lotSize, 0n);
  assert.ok(sized.quantity >= coarse.minQuantity);
  assert.ok(sized.cost <= 2000000n);
});

test("the fallback params match a real Shannon pool", () => {
  assert.deepEqual(DEFAULT_POOL_PARAMS, SHANNON_POOL);
});

test("cost is price times quantity over one unit", () => {
  assert.equal(PRICE_SCALE, 1000000n);
  assert.equal(orderCost(800000n, 2000000n), 1600000n);   // 2.0 @ $0.80 = $1.60
  assert.notEqual(800000n * 2000000n, 1600000n);          // the raw product is not the cost
});

// ---- successor selection -----------------------------------------------

const { nextWindowFor, isCadenceSubstitution } = await import("./strategy.js");
const mkt = (asset, intervalSec, expiry, n) => ({
  asset, intervalSec, expiry,
  marketId: `0x${String(n).repeat(64)}`, pool: `0x${String(n).repeat(40)}`,
});

test("a continuation never crosses to another asset", () => {
  const btc = mkt("BTC", 900, 1000, 1);
  const eth = mkt("ETH", 900, 2000, 2);
  assert.equal(nextWindowFor([btc, eth], btc), null, "BTC must never roll into ETH");
});

test("the same cadence is preferred", () => {
  const btc = mkt("BTC", 900, 1000, 1);
  const btcHour = mkt("BTC", 3600, 2000, 2);
  const btcNext = mkt("BTC", 898, 3000, 3);   // same cadence, reported imprecisely
  assert.equal(nextWindowFor([btc, btcHour, btcNext], btc).marketId, btcNext.marketId);
});

test("a cadence-specific request is refused rather than substituted", () => {
  const btc = mkt("BTC", 900, 1000, 1);
  const btcHour = mkt("BTC", 3600, 2000, 2);
  assert.equal(nextWindowFor([btc, btcHour], btc, { requireCadence: true }), null);
});

test("a generic continuation may change cadence, and says so", () => {
  const btc = mkt("BTC", 900, 1000, 1);
  const btcHour = mkt("BTC", 3600, 2000, 2);
  const next = nextWindowFor([btc, btcHour], btc);
  assert.equal(next.marketId, btcHour.marketId);
  assert.equal(isCadenceSubstitution(btc, next), true, "the interface must disclose this");
});

// ---- what the trader reads ---------------------------------------------

const { branchActions } = await import("./lib/language.js");
const { notionalOf } = await import("./strategy.js");

test("the amount shown on a branch is the amount actually committed", () => {
  const step = {
    price: 500000n, quantity: 4000000n, notionalCap: 2000000n,
    actionOnWin0: 0, actionOnWin1: 2,
  };
  const { yes, no } = branchActions(step, { asset: "BTC", intervalSec: 900 });
  assert.equal(yes.size, "$2");
  assert.equal(no.size, "$2");
  assert.equal(notionalOf(step), 2000000n);
  assert.equal(orderCost(step.price, step.quantity), notionalOf(step));
});

test("a stop shows no amount at all", () => {
  const step = { price: 500000n, quantity: 4000000n, actionOnWin0: 0, actionOnWin1: 255 };
  const { no } = branchActions(step, { asset: "BTC", intervalSec: 900 });
  assert.equal(no.stop, true);
  assert.equal(no.size, "—");
});
