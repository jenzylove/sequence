// Quick Start has to price a trade the same way the manual builder does.
//
// It did not. It divided the per-trade cap by the price directly, which drops
// the 1e6 price scale that quantities are denominated in: "$2 a trade" became
// four base units, and the review pane showed $0.00. A trader reading that
// screen is being told their $2 order is worthless.
//
// These reproduce the two screenshots, and pin the case that used to disable the
// whole builder: an account that has not been funded yet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "./lib/command.js";
import { notionalOf, validate, notices } from "./strategy.js";

// Two windows of the same series, which is what a rolling sequence needs.
const now = Math.floor(Date.now() / 1000);
const market = (id, expiry) => ({
  marketId: `0x${id.toString(16).padStart(64, "0")}`,
  asset: "BTC", intervalSec: 900, expiry,
  pool: `0x${"ab".repeat(20)}`,
  lastPrice: 500000n,          // $0.50
  question: "BTC closes higher than open",
});
const open = [market(1, now + 900), market(2, now + 1800), market(3, now + 2700), market(4, now + 3600)];

const perTrade = (strategy) => notionalOf(strategy.steps[0]);
const dollars = (raw) => Number(raw) / 1e6;

test("$2 a trade previews about $2, never $0", () => {
  const { strategy } = parseCommand("Roll BTC 15m three times, $2 a trade, $5 total", { open });
  assert.ok(strategy, "the command should produce a strategy");
  const value = perTrade(strategy);
  assert.ok(value > 0n, "a sized trade must never preview as zero");
  assert.ok(dollars(value) > 1.9 && dollars(value) <= 2.0,
    `expected about $2.00 per trade, got $${dollars(value).toFixed(6)}`);
});

test("$1 a trade previews about $1", () => {
  const { strategy } = parseCommand("Roll BTC 15m twice, $1 a trade, $4 total", { open });
  const value = perTrade(strategy);
  assert.ok(dollars(value) > 0.9 && dollars(value) <= 1.0,
    `expected about $1.00 per trade, got $${dollars(value).toFixed(6)}`);
});

test("every step is priced, not just the first", () => {
  const { strategy } = parseCommand("Roll BTC 15m three times, $2 a trade, $6 total", { open });
  for (const [i, step] of strategy.steps.entries()) {
    assert.ok(notionalOf(step) > 0n, `step ${i + 1} previewed as zero`);
  }
});

test("no step is sized past its own cap", () => {
  const { strategy } = parseCommand("Roll BTC 15m three times, $2 a trade, $6 total", { open });
  for (const step of strategy.steps) {
    assert.ok(notionalOf(step) <= step.notionalCap,
      `step sized at ${notionalOf(step)} above its ${step.notionalCap} cap`);
  }
});

test("quantities land on the lot grid the pool will accept", () => {
  const { strategy } = parseCommand("Roll BTC 15m twice, $2 a trade, $5 total", { open });
  for (const step of strategy.steps) {
    assert.equal(step.quantity % 1000n, 0n, "quantity must be a whole number of lots");
    assert.ok(step.quantity >= 1000n, "quantity must meet the pool minimum");
  }
});

// ---- an unfunded account must not stop anyone building ---------------------

test("Use this works while the Sequence account is unfunded", () => {
  const { strategy } = parseCommand("Roll BTC 15m three times, $2 a trade, $5 total", { open, bankroll: 0n });
  assert.ok(strategy, "an unfunded account must still produce a strategy");
  const errors = validate({ ...strategy, bankroll: 0n });
  assert.equal(errors.length, 0,
    `an unfunded account must not produce build errors, got: ${errors.map((e) => e.message).join("; ")}`);
});

test("an unfunded account is mentioned, not enforced", () => {
  const { strategy } = parseCommand("Roll BTC 15m twice, $2 a trade, $5 total", { open, bankroll: 0n });
  const said = notices({ ...strategy, bankroll: 0n });
  assert.ok(said.some((n) => /fund it when you activate/i.test(n)),
    "the builder should say funding comes at activation");
});

test("a funded account says nothing about funding", () => {
  const { strategy } = parseCommand("Roll BTC 15m twice, $2 a trade, $5 total", { open, bankroll: 50000000n });
  const said = notices({ ...strategy, bankroll: 50000000n });
  assert.ok(!said.some((n) => /fund it when you activate/i.test(n)),
    "a funded account should not be nagged about funding");
});
