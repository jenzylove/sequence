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

// The working strategy used to live under one global key, which meant switching
// wallets in the same browser restored the previous wallet's builder state. The
// wallet-scoped draft store is now the only persistence, so this exists solely
// to clear what older builds left behind.
const LEGACY_STRATEGY_KEY = "sequence.strategy.v1";

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
    // provisional only: replaced by the live book as soon as a market is picked
    price: 500000n,
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
// The window a step trades into once its watched market settles.
//
// Same asset, always: rolling BTC must never continue into ETH. Cadence is
// preferred and, when the trader asked for a specific one, required - silently
// continuing a 15m plan into a 1h market is not the sequence they authorised.
// Returns null rather than substituting something, so the caller can say so.
export function nextWindowFor(markets, after, { requireCadence = false } = {}) {
  if (!after) return null;
  const later = markets
    .filter((m) => m.pool && m.marketId !== after.marketId && (m.expiry || 0) > (after.expiry || 0))
    .sort((a, b) => (a.expiry || 0) - (b.expiry || 0));

  const cadence = normaliseInterval(after.intervalSec);
  const sameCadence = later.find((m) => m.asset === after.asset && normaliseInterval(m.intervalSec) === cadence);
  if (sameCadence || requireCadence) return sameCadence || null;

  // A continuation may use the asset's next window at another cadence, because
  // only one window per series is open at a time and refusing would make most
  // markets a dead end. But it may not change the horizon beyond recognition.
  //
  // Watching a 4h market and rolling into a 45-day contract is not "the next
  // window" in any sense a trader means: it is a 270x jump, and rolling twice
  // would put settlement months out. A substitute has to stay within reach of
  // what was actually being watched.
  return later.find((m) =>
    m.asset === after.asset
    && normaliseInterval(m.intervalSec) <= cadence * MAX_SUBSTITUTE_MULTIPLE) || null;
}

// How much longer a substitute window may run than the one being watched.
// 24x lets a 5m roll into an hour and a 4h roll into a day, and stops a 4h from
// becoming a month and a half.
export const MAX_SUBSTITUTE_MULTIPLE = 24;

// True when the continuation is not the same cadence the trader was looking at,
// so the interface can say which market it will actually trade.
export function isCadenceSubstitution(after, next) {
  if (!after || !next) return false;
  return normaliseInterval(after.intervalSec) !== normaliseInterval(next.intervalSec);
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
  strat.name = autoNameFor(trigger.asset);
  return strat;
}

// The sequence's name follows the market it watches, until a trader renames it.
//
// It used to be stamped once when the builder seeded itself and then left alone,
// so switching the watched market from ETH to BTC left "ETH sequence" sitting at
// the top of a panel showing BTC — the label contradicting the thing it labels.
export const autoNameFor = (asset) => `${asset || "Rolling"} sequence`;

// True while the name is still one we generated, which is what makes it safe to
// replace. Anything a trader typed is theirs and is left alone.
export function isAutoName(name) {
  return !name || name === "Untitled sequence" || /^[A-Za-z0-9]+ sequence$/.test(name);
}

// Matches SequenceVault._cost: prices are 6dp fractions and quantities are 6dp
// base units, so an order costs price*quantity/1e6.
export const PRICE_SCALE = 1000000n;
export const notionalOf = (step) => (step.price * step.quantity) / PRICE_SCALE;

// Same checks the vault applies, run before the user is ever asked to sign.
export function validate(strategy) {
  const errors = [];
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
  // An unfunded account is a thing to say, not a thing to stop on. Funding is
  // asked for at activation, so blocking the builder on it only prevented people
  // from designing a sequence before they had paid for anything.
  if (strategy.maxOutstanding > (strategy.bankroll ?? 0n)) {
    out.push(`This risks up to ${money(strategy.maxOutstanding)} and your account holds ${money(strategy.bankroll ?? 0n)}. You will be asked to fund it when you activate.`);
  }
  return out;
}

const money = (raw) => "$" + (Number(raw) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 });

// expireTimestampNs is nanoseconds and must be strictly future, and no later
// than the successor market's own expiry (docs/VERIFIED.md).
// When the follow-on order stops being valid.
//
// This used to take the *earlier* of the successor market's expiry and one hour
// from now, which quietly capped every order at an hour after activation. For
// the first step that is harmless: it fires within minutes. For a queued second
// step it is fatal — it only fires when its own trigger settles, which can be
// hours later, by which time the order it was carrying had already expired and
// the pool refused it with `OrderAlreadyExpired()`. A two-step sequence spanning
// more than an hour could therefore never complete, which is the one thing the
// product exists to do.
//
// The real deadline is the market being traded into: past its expiry there is
// nothing to buy, and the vault's own notional cap — not a clock — is what
// bounds the risk. The hour is only a fallback for when we do not know the
// market's expiry at all.
export function expireNsFor(step, now = Date.now()) {
  if (step.successorExpiry) return BigInt(step.successorExpiry) * 1_000_000_000n;
  return BigInt(Math.floor(now / 1000) + 3600) * 1_000_000_000n;
}

const ZERO32 = `0x${"00".repeat(32)}`;

// nextStepId links the chain on chain: the vault arms it only after this step
// actually places an order.
// The vault's Step struct has fourteen fields. Eleven describe the rule the
// trader wrote; the other three are the vault's own runtime state — which step
// it is up to, the order it placed, the outcome it read.
//
// This used to return only the eleven, leaving `status`, `orderId` and
// `winningOutcome` undefined. Every script that armed a step had quietly
// compensated by spreading them in by hand, so the gap never showed up in a
// proof — but the builder, which is the only path a real trader takes, did not,
// and viem turned the hole into "Cannot convert undefined to a BigInt" at the
// moment of signing.
//
// The three runtime fields are not a default we are inventing. A step that has
// never run is by definition NONE, with no order and no outcome, and the
// contract overwrites all three the moment it acts. Producing a complete,
// encodable struct is this function's whole job, so it does it here once rather
// than asking each caller to remember.
export const VAULT_STEP_FIELDS = [
  "status", "triggerMarketId", "pool", "price", "quantity", "expireNs",
  "orderType", "actionOnWin0", "actionOnWin1", "notionalCap",
  "successorMarketId", "nextStepId", "orderId", "winningOutcome",
];

export function toVaultStep(step, now = Date.now(), nextStepId = ZERO32) {
  return {
    // The rule.
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
    // The vault's runtime state, at the only value it can hold before it runs.
    status: 0,          // Status.NONE
    orderId: 0n,        // nothing placed yet
    winningOutcome: 0,  // nothing read yet
  };
}

/// Refuse to hand the ABI encoder a hole.
///
/// A missing numeric field becomes `BigInt(undefined)` deep inside viem, which
/// reads as a bug in the wallet rather than in us. This names the field instead,
/// before a wallet is ever opened.
export function assertVaultStep(step, where = "this step") {
  const missing = VAULT_STEP_FIELDS.filter((f) => step?.[f] === undefined || step?.[f] === null);
  if (missing.length) {
    throw new Error(`${where} is incomplete: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing.`);
  }
  return step;
}

export const onchainStepId = (strategy, step) => stepIdFor(`${strategy.name}::${step.name}`);

// ---- persistence (bigints survive the round trip) ---------------------------

const replacer = (_k, v) => (typeof v === "bigint" ? { __bigint: v.toString() } : v);
const reviver = (_k, v) => (v && typeof v === "object" && v.__bigint ? BigInt(v.__bigint) : v);

export function purgeLegacyStrategy() {
  try { localStorage.removeItem(LEGACY_STRATEGY_KEY); } catch { /* storage unavailable */ }
}
