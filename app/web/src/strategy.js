// The real Sequence strategy model. Deliberately shaped like SequenceVault.Step
// (src/SequenceVault.sol) and app/planner/model.ts so the builder edits the same
// object that gets encoded into armStep, and validates by the same rules the
// vault enforces on chain.
import { stepIdFor } from "./chain/vault.js";
import { normaliseInterval } from "./lib/language.js";

// What the account does when an outcome wins. The buy values are the pool's own
// side codes, so nothing is translated before it reaches the contract; STOP is
// a sentinel outside that range meaning "place nothing". Mirrors
// SequenceVault.ACT_* exactly.
export const ACTION = { BUY_YES: 0, BUY_NO: 2, STOP: 255 };
export const ACTION_CHOICES = [
  { value: ACTION.BUY_YES, label: "Buy YES" },
  { value: ACTION.BUY_NO, label: "Buy NO" },
  { value: ACTION.STOP, label: "Stop" },
];
export const isAction = (a) => a === ACTION.BUY_YES || a === ACTION.BUY_NO || a === ACTION.STOP;

export const ORDER_TYPES = [
  { value: 0, label: "Normal" },
  { value: 1, label: "Fill or kill" },
  { value: 2, label: "Immediate or cancel" },
  { value: 3, label: "Post only" },
];

const STORAGE_KEY = "sequence.strategy.v1";

export function makeStep(index, { triggerMarket, successorMarket } = {}) {
  return {
    key: `step${index}`,
    name: `step-${index}`,
    triggerMarketId: triggerMarket?.marketId || "",
    triggerLabel: triggerMarket?.question || "",
    triggerExpiry: triggerMarket?.expiry || null,
    successorMarketId: successorMarket?.marketId || "",
    successorLabel: successorMarket?.question || "",
    successorExpiry: successorMarket?.expiry || null,
    pool: successorMarket?.pool || "",
    price: 600000n,
    quantity: 5n,
    notionalCap: 4000000n,
    actionOnWin0: ACTION.BUY_YES,
    actionOnWin1: ACTION.BUY_NO,
    orderType: 2,
  };
}

// Drafts saved before per-outcome actions existed carried a single flag.
export function migrateStep(step) {
  if (isAction(step.actionOnWin0) && isAction(step.actionOnWin1)) return step;
  const yesFirst = step.buyYesOnWin0 !== false;
  const { buyYesOnWin0, ...rest } = step;
  return {
    ...rest,
    actionOnWin0: yesFirst ? ACTION.BUY_YES : ACTION.BUY_NO,
    actionOnWin1: yesFirst ? ACTION.BUY_NO : ACTION.BUY_YES,
  };
}
export const migrateStrategy = (s) => (s && s.steps ? { ...s, steps: s.steps.map(migrateStep) } : s);

export function emptyStrategy() {
  return { name: "Untitled sequence", bankroll: 10000000n, maxOutstanding: 5000000n, steps: [] };
}

// The window a step should trade into once its watched market settles: the next
// open window of the same asset, preferring the same cadence. Only one window
// per series is open at a time, so the same-cadence match usually does not
// exist and the next window of that asset is the honest choice.
export function nextWindowFor(markets, after) {
  if (!after) return null;
  const later = markets
    .filter((m) => m.pool && m.marketId !== after.marketId && (m.expiry || 0) > (after.expiry || 0))
    .sort((a, b) => (a.expiry || 0) - (b.expiry || 0));
  const cadence = normaliseInterval(after.intervalSec);
  return later.find((m) => m.asset === after.asset && normaliseInterval(m.intervalSec) === cadence)
    || later.find((m) => m.asset === after.asset)
    || later[0]
    || null;
}

// Seed from real open markets: watch the soonest window that has something to
// roll into, and trade into that. Never returns a stepless strategy while two
// markets are open, because a builder with no step is a dead end.
export function seedFromMarkets(markets) {
  const strat = emptyStrategy();
  const open = (markets || []).filter((m) => m.pool && m.marketId).sort((a, b) => (a.expiry || 0) - (b.expiry || 0));
  if (open.length < 2) return strat;

  let trigger = null;
  let successor = null;
  for (const candidate of open) {
    const next = nextWindowFor(open, candidate);
    if (next) { trigger = candidate; successor = next; break; }
  }
  if (!trigger || !successor) return strat;

  strat.steps = [makeStep(1, { triggerMarket: trigger, successorMarket: successor })];
  strat.name = `${trigger.asset || "Rolling"} sequence`;
  return strat;
}

export const notionalOf = (step) => step.price * step.quantity;

// Same checks the vault applies, run before the user is ever asked to sign.
export function validate(strategy) {
  const errors = [];
  if (strategy.maxOutstanding > strategy.bankroll) {
    errors.push({ scope: "vault", message: "Outstanding cap is above the bankroll funded to the vault." });
  }
  if (strategy.maxOutstanding <= 0n) {
    errors.push({ scope: "vault", message: "Outstanding cap must be above zero." });
  }
  if (!strategy.steps.length) errors.push({ scope: "vault", message: "Add at least one bounded step." });

  const seen = new Set();
  for (const step of strategy.steps) {
    const at = step.key;
    if (!/^0x[0-9a-fA-F]{64}$/.test(step.triggerMarketId)) {
      errors.push({ scope: at, message: "Pick a trigger market to watch." });
    } else if (seen.has(step.triggerMarketId.toLowerCase())) {
      errors.push({ scope: at, message: "Two steps watch the same market; the vault keeps only one." });
    } else {
      seen.add(step.triggerMarketId.toLowerCase());
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(step.pool)) {
      errors.push({ scope: at, message: "Pick a successor market so the step has a real pool to place into." });
    }
    if (step.price <= 0n || step.quantity <= 0n) {
      errors.push({ scope: at, message: "Price and size must both be above zero." });
    }
    if (notionalOf(step) > step.notionalCap) {
      errors.push({ scope: at, message: "Order value is above this step's own cap." });
    }
    if (notionalOf(step) > strategy.maxOutstanding) {
      errors.push({ scope: at, message: "That trade alone is above your total risk limit." });
    }
    if (!isAction(step.actionOnWin0) || !isAction(step.actionOnWin1)) {
      errors.push({ scope: at, message: "Choose what happens on each result." });
    }
  }
  return errors;
}

// Conditions that are not configuration errors but change what the vault will
// actually do. These never block arming; they explain the outcome in advance.
export function notices(strategy) {
  const out = [];
  const planned = strategy.steps.reduce((sum, s) => sum + notionalOf(s), 0n);
  if (planned > strategy.maxOutstanding) {
    out.push(`If every trade fires it would commit ${money(planned)}, past your ${money(strategy.maxOutstanding)} limit. Sequence will stand down the trades that would cross it.`);
  }
  if (strategy.maxOutstanding > 0n && planned === 0n) {
    out.push("No trade is sized yet. Set an amount per trade.");
  }
  return out;
}

const money = (raw) => "$" + (Number(raw) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 });

// expireTimestampNs is nanoseconds and must be strictly future, and no later
// than the successor market's own expiry (docs/VERIFIED.md).
export function expireNsFor(step, now = Date.now()) {
  const marketExpiryNs = step.successorExpiry ? BigInt(step.successorExpiry) * 1_000_000_000n : null;
  const defaultNs = BigInt(Math.floor(now / 1000) + 3600) * 1_000_000_000n;
  if (marketExpiryNs && marketExpiryNs < defaultNs) return marketExpiryNs;
  return defaultNs;
}

const ZERO32 = `0x${"00".repeat(32)}`;

// nextStepId links the chain on chain: the vault arms it only after this step
// actually places an order.
export function toVaultStep(step, now = Date.now(), nextStepId = ZERO32) {
  return {
    successorMarketId: step.successorMarketId || ZERO32,
    nextStepId,
    triggerMarketId: step.triggerMarketId,
    pool: step.pool,
    price: step.price,
    quantity: step.quantity,
    expireNs: expireNsFor(step, now),
    orderType: step.orderType,
    actionOnWin0: step.actionOnWin0,
    actionOnWin1: step.actionOnWin1,
    notionalCap: step.notionalCap,
  };
}

export const onchainStepId = (strategy, step) => stepIdFor(`${strategy.name}::${step.name}`);

// ---- persistence (bigints survive the round trip) ---------------------------

const replacer = (_k, v) => (typeof v === "bigint" ? { __bigint: v.toString() } : v);
const reviver = (_k, v) => (v && typeof v === "object" && v.__bigint ? BigInt(v.__bigint) : v);

export function saveStrategy(strategy) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(strategy, replacer)); } catch { /* storage unavailable */ }
}

export function loadStrategy() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw, reviver);
    if (!parsed?.steps?.length) return null;
    return migrateStrategy(parsed);
  } catch { return null; }
}

export function clearStrategy() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
}
