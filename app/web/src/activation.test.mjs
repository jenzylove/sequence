// A two-step activation must encode.
//
// Activating a two-step sequence from the builder failed with "Cannot convert
// undefined to a BigInt". The vault's Step struct has fourteen fields;
// `toVaultStep` returned eleven, leaving `status`, `orderId` and
// `winningOutcome` undefined. `armStep` happened to fill those three in itself,
// so a one-step sequence worked and hid the hole — but `queueStep` passes the
// struct straight to the encoder, and queueStep only runs when there is a second
// step. So the bug was invisible until somebody built a real chain.
//
// These encode a genuine two-step payload against the real ABI. Anything left
// undefined fails here rather than in a wallet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData } from "viem";
import { vaultAbi } from "./chain/abi.js";
import { toVaultStep, assertVaultStep, VAULT_STEP_FIELDS, onchainStepId, expireNsFor } from "./strategy.js";
import { parseCommand } from "./lib/command.js";

const now = Math.floor(Date.now() / 1000);
const market = (id, expiry) => ({
  marketId: `0x${id.toString(16).padStart(64, "0")}`,
  asset: "BTC", intervalSec: 900, expiry,
  pool: `0x${"ab".repeat(20)}`,
  lastPrice: 500000n,
  question: "BTC closes higher than open",
});
const open = [market(1, now + 900), market(2, now + 1800), market(3, now + 2700), market(4, now + 3600)];

// The real thing a trader gets: more than one step, so queueStep is exercised.
function twoStepStrategy() {
  const { strategy } = parseCommand("Roll BTC 15m twice, $2 a trade, $5 total", { open });
  assert.ok(strategy, "the command should produce a strategy");
  assert.ok(strategy.steps.length >= 2, `expected a multi-step sequence, got ${strategy.steps.length}`);
  return strategy;
}

const ZERO32 = `0x${"00".repeat(32)}`;

test("every ABI field of a real two-step payload is defined", () => {
  const strategy = twoStepStrategy();
  const ids = strategy.steps.map((s) => onchainStepId(strategy, s));

  strategy.steps.forEach((s, i) => {
    const next = i + 1 < ids.length ? ids[i + 1] : ZERO32;
    const step = toVaultStep(s, Date.now(), next);
    const missing = VAULT_STEP_FIELDS.filter((f) => step[f] === undefined || step[f] === null);
    assert.deepEqual(missing, [], `step ${i + 1} is missing ${missing.join(", ")}`);
  });
});

test("the queued step encodes against the real ABI", () => {
  const strategy = twoStepStrategy();
  const ids = strategy.steps.map((s) => onchainStepId(strategy, s));

  // This is the exact call the builder makes for step 2, and the one that used
  // to throw before a wallet ever opened.
  const data = encodeFunctionData({
    abi: vaultAbi, functionName: "queueStep",
    args: [ids[1], toVaultStep(strategy.steps[1], Date.now(), ZERO32)],
  });
  assert.ok(data.startsWith("0x") && data.length > 200, "queueStep should encode to real calldata");
});

test("the armed step encodes against the real ABI", () => {
  const strategy = twoStepStrategy();
  const ids = strategy.steps.map((s) => onchainStepId(strategy, s));
  const data = encodeFunctionData({
    abi: vaultAbi, functionName: "armStep",
    args: [ids[0], toVaultStep(strategy.steps[0], Date.now(), ids[1])],
  });
  assert.ok(data.startsWith("0x") && data.length > 200, "armStep should encode to real calldata");
});

test("a step that has never run carries the vault's initial runtime state", () => {
  const strategy = twoStepStrategy();
  const step = toVaultStep(strategy.steps[0], Date.now(), ZERO32);
  // Not arbitrary defaults: these are the only values the vault can hold for a
  // step it has not acted on, and it overwrites all three when it does.
  assert.equal(step.status, 0, "a step that has never run is NONE");
  assert.equal(step.orderId, 0n, "nothing has been placed yet");
  assert.equal(step.winningOutcome, 0, "no outcome has been read yet");
});

test("a hole in the payload is named, not thrown from inside the encoder", () => {
  const strategy = twoStepStrategy();
  const broken = { ...toVaultStep(strategy.steps[0], Date.now(), ZERO32), orderId: undefined };
  assert.throws(
    () => assertVaultStep(broken, "This queued step"),
    (e) => /This queued step is incomplete: orderId is missing/.test(e.message),
    "the missing field should be named",
  );
});

test("the chain is linked: step one points at step two", () => {
  const strategy = twoStepStrategy();
  const ids = strategy.steps.map((s) => onchainStepId(strategy, s));
  const first = toVaultStep(strategy.steps[0], Date.now(), ids[1]);
  assert.equal(first.nextStepId, ids[1], "step one must name step two, or the chain never advances");
  assert.notEqual(first.nextStepId, ZERO32);
});


// ---- the order must still be valid when it is finally placed ---------------
//
// A queued step does not fire when it is signed; it fires when its own trigger
// settles, which can be hours later. The order expiry used to be capped at an
// hour from activation, so the second step of any sequence spanning more than an
// hour arrived at the pool already expired and was refused with
// `OrderAlreadyExpired()`. Twice, on chain, before this was understood.

test("a follow-on order stays valid until its market closes, not one hour after signing", () => {
  const now = Date.now();
  const fourHoursOut = Math.floor(now / 1000) + 4 * 3600;
  const expiry = expireNsFor({ successorExpiry: fourHoursOut }, now);
  assert.equal(expiry, BigInt(fourHoursOut) * 1_000_000_000n,
    "the order should live until the market it trades into closes");

  const oneHourNs = BigInt(Math.floor(now / 1000) + 3600) * 1_000_000_000n;
  assert.ok(expiry > oneHourNs, "an hour-from-now cap would expire this order before it could ever place");
});

test("a step whose settlement is hours away is still placeable when it fires", () => {
  const now = Date.now();
  const settlesIn = 3.5 * 3600;                       // the gap that broke it on chain
  const step = { successorExpiry: Math.floor(now / 1000) + settlesIn + 1800 };
  const expiryS = Number(expireNsFor(step, now) / 1_000_000_000n);
  const firesAt = Math.floor(now / 1000) + settlesIn;
  assert.ok(expiryS > firesAt,
    `order expires at ${expiryS} but only fires at ${firesAt}: it would be rejected as already expired`);
});

test("without a known market expiry the order is still bounded", () => {
  const now = Date.now();
  const expiry = expireNsFor({}, now);
  assert.equal(expiry, BigInt(Math.floor(now / 1000) + 3600) * 1_000_000_000n,
    "an unknown market still gets a bounded order rather than an open-ended one");
});
