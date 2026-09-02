// The real Sequence strategy model. Deliberately shaped like SequenceVault.Step
// (src/SequenceVault.sol) and app/planner/model.ts so the builder edits the same
// object that gets encoded into armStep, and validates by the same rules the
// vault enforces on chain.
import { stepIdFor } from "./chain/vault.js";

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
    buyYesOnWin0: true,
    orderType: 2,
  };
}

export function emptyStrategy() {
  return { name: "Untitled sequence", bankroll: 10000000n, maxOutstanding: 5000000n, steps: [] };
}

// Seed from real open markets: step N watches market N and places into N+1,
// which is exactly the rolling pattern the product is built for.
export function seedFromMarkets(markets) {
  const strat = emptyStrategy();
  if (!markets || markets.length < 2) return strat;
  const byAsset = {};
  for (const m of markets) (byAsset[m.asset] ||= []).push(m);
  const chain = Object.values(byAsset).sort((a, b) => b.length - a.length)[0] || markets;
  strat.steps = [
    makeStep(1, { triggerMarket: chain[0], successorMarket: chain[1] || markets[1] }),
    makeStep(2, { triggerMarket: chain[1] || markets[1], successorMarket: chain[2] || markets[0] }),
  ];
  strat.name = `${chain[0].asset || "Rolling"} rolling sequence`;
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
      errors.push({ scope: at, message: "Order value alone is above the vault's outstanding cap." });
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
    out.push(`If every step fires, the plan commits ${money(planned)} against a ${money(strategy.maxOutstanding)} vault cap. The vault will skip the steps that would cross it.`);
  }
  if (strategy.maxOutstanding > 0n && planned === 0n) {
    out.push("No step commits anything yet; set a price and size.");
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

export function toVaultStep(step, now = Date.now()) {
  return {
    triggerMarketId: step.triggerMarketId,
    pool: step.pool,
    price: step.price,
    quantity: step.quantity,
    expireNs: expireNsFor(step, now),
    orderType: step.orderType,
    buyYesOnWin0: step.buyYesOnWin0,
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
    return parsed;
  } catch { return null; }
}

export function clearStrategy() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
}
