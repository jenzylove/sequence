// One place where protocol vocabulary becomes trader vocabulary.
// The primary interface speaks only the right-hand side of this file. Addresses,
// event names, pool ids, step ids and transaction hashes stay behind an
// "Onchain details" disclosure, never in the main reading path.

// SequenceVault.Status -> what a trader actually sees.
export const STATUS_COPY = {
  NONE: { label: "Draft", tone: "draft", blurb: "Not sent to the market yet." },
  ARMED: { label: "Live", tone: "live", blurb: "Waiting for the market to settle." },
  WAITING: { label: "Live", tone: "live", blurb: "Waiting for the market to settle." },
  TRIGGERED: { label: "Settling", tone: "live", blurb: "The market just settled. Working out the next trade." },
  EXECUTED: { label: "Trade placed", tone: "done", blurb: "The follow-on trade went in." },
  SKIPPED: { label: "Stood down", tone: "done", blurb: "Your rules said not to trade this one." },
  EXPIRED: { label: "Expired", tone: "done", blurb: "The window closed before it could run." },
  CANCELLED: { label: "Cancelled", tone: "done", blurb: "You called it off." },
};

export const statusCopy = (label) => STATUS_COPY[label] || STATUS_COPY.NONE;

// Which bucket a sequence belongs in on the dashboard.
export const LIVE_STATUSES = ["ARMED", "WAITING", "TRIGGERED"];
export const DONE_STATUSES = ["EXECUTED", "SKIPPED", "EXPIRED", "CANCELLED"];
export const bucketFor = (statusLabel) => {
  if (LIVE_STATUSES.includes(statusLabel)) return "active";
  if (DONE_STATUSES.includes(statusLabel)) return "completed";
  return "draft";
};

// Why the vault stood a trade down, in plain words.
export const SKIP_REASON = {
  voided: "the market was cancelled, so there was no result to act on",
  "no-clean-winner": "the result came back unclear, so nothing was risked",
  "questionId-mismatch": "the result did not match the market on file, so it was ignored",
  stop: "you set this result to stop, so it placed nothing",
  "step-cap": "the trade was larger than the limit you set for this step",
  "vault-cap": "it would have pushed you past your total risk limit",
};
export const skipReason = (raw) => SKIP_REASON[raw] || raw;

// Order types, named the way an order ticket names them.
export const ORDER_TYPE_COPY = {
  0: { label: "Standard", blurb: "Rests on the book until filled or expired." },
  1: { label: "All or nothing", blurb: "Fills completely straight away, or not at all." },
  2: { label: "Fill what you can", blurb: "Takes whatever is available now, cancels the rest." },
  3: { label: "Queue only", blurb: "Only joins the book; never crosses the spread." },
};

export const SIDE_COPY = { 0: "Buy YES", 1: "Sell YES", 2: "Buy NO", 3: "Sell NO" };

// The indexer reports window lengths slightly off the round number (298 rather
// than 300, 898 rather than 900), so they are snapped to the cadence a trader
// would name before being shown or grouped on.
const BUCKETS = [60, 300, 900, 3600, 14400, 86400];
export function normaliseInterval(seconds) {
  if (!seconds) return null;
  let best = BUCKETS[0];
  for (const b of BUCKETS) if (Math.abs(b - seconds) < Math.abs(best - seconds)) best = b;
  // Only snap when it is genuinely close; otherwise report what was given.
  return Math.abs(best - seconds) <= Math.max(5, best * 0.05) ? best : seconds;
}

// How long a market's window runs, said the way a trader says it.
export function intervalLabel(rawSeconds) {
  const seconds = normaliseInterval(rawSeconds);
  if (!seconds) return "";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

// The market's name: "BTC 15m". This is what a trader calls it, and it is what
// the primary interface uses everywhere.
export function marketName(market) {
  if (!market) return "a market";
  const asset = market.asset || "Market";
  const every = intervalLabel(market.intervalSec);
  return every ? `${asset} ${every}` : asset;
}

// The question the market actually settles, in plain words. The indexer's own
// text carries protocol noise ("Pricefeed test: will BTC/USDC's price be at or
// above 77013.10 at unix time ..."), which is never shown to a trader.
export function marketQuestion(market) {
  if (!market) return "";
  const asset = market.asset || "the market";
  const q = market.question || "";
  if (/closes at or above its opening price/i.test(q)) {
    return `Does ${asset} close higher than it opened?`;
  }
  const strike = q.match(/at or above ([\d,.]+)/i);
  if (strike) {
    const level = Number(strike[1].replace(/,/g, ""));
    return `Is ${asset} above $${level.toLocaleString(undefined, { maximumFractionDigits: 2 })}?`;
  }
  return `How does ${asset} settle?`;
}

// A few words distinguishing two windows of the same name, for pickers where
// "ETH 5m" would otherwise appear twice.
export function marketShortAsk(market) {
  const q = market?.question || "";
  if (/closes at or above its opening price/i.test(q)) return "closes higher than open";
  const strike = q.match(/at or above ([\d,.]+)/i);
  if (strike) {
    const level = Number(strike[1].replace(/,/g, ""));
    return `above $${level.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  return "";
}

// Kept for compact contexts: the market name plus what it asks.
export function marketHeadline(market) {
  return marketName(market);
}

// "in 3m 20s" / "settling now" / "settled 4m ago"
export function countdown(unixSeconds, now = Date.now()) {
  if (!unixSeconds) return "no set time";
  const delta = unixSeconds * 1000 - now;
  const abs = Math.abs(delta);
  const m = Math.floor(abs / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  if (abs < 20000) return "settling now";
  const span = m > 59 ? `${Math.floor(m / 60)}h ${m % 60}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  return delta > 0 ? `in ${span}` : `${span} ago`;
}

// "settling now" / "settles in 2m 9s" / "settled 4m ago" - reads on its own,
// so callers never have to prepend a verb and end up with "settles settling now".
export function settlePhrase(unixSeconds, now = Date.now()) {
  if (!unixSeconds) return "no set time";
  const delta = unixSeconds * 1000 - now;
  if (Math.abs(delta) < 20000) return "settling now";
  return delta > 0 ? `settles ${countdown(unixSeconds, now)}` : `settled ${countdown(unixSeconds, now)}`;
}

export const money = (raw, decimals = 6) =>
  "$" + (Number(raw) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: 2 });

// Binary market prices are quoted 0-1 in collateral terms; traders read them as odds.
export const asOdds = (raw) => (raw === null || raw === undefined ? null : Math.round((Number(raw) / 1e6) * 100));

// What each side of a settlement does. The account always acts on a clean
// result: one outcome buys YES, the other buys NO. Which way round is the
// trader's choice, and this is the single place that mapping is described.
export function branchActions(step, successorMarket) {
  const next = marketName(successorMarket) || step.successorLabel || "the next market";
  const size = money(step.price * step.quantity);
  const describe = (action) => {
    if (action === 255) {
      return { stop: true, side: null, text: "Stop", verb: "stops and places nothing", size: "—" };
    }
    const side = action === 2 ? "NO" : "YES";
    return { stop: false, side, text: `Buy ${side} in the next ${next}`, verb: `buys ${side} in the next ${next}`, size };
  };
  return { yes: describe(step.actionOnWin0), no: describe(step.actionOnWin1) };
}

// One sentence describing what a whole step will do, in trader language.
export function describeStep(step, { triggerMarket, successorMarket } = {}) {
  const watch = marketName(triggerMarket) || step.triggerLabel || "your chosen market";
  const { yes, no } = branchActions(step, successorMarket);
  const up = yes.stop ? "Sequence stops" : `Sequence ${yes.verb} for ${yes.size}`;
  const down = no.stop ? "it stops" : `it ${no.verb} for ${no.size}`;
  const risk = yes.stop && no.stop ? "" : ` It risks at most ${money(step.notionalCap)} on that trade.`;
  return `When ${watch} settles: if it closes up, ${up}. If it closes down, ${down}.${risk}`;
}

// The whole plan in one plain sentence, for the moment before activating.
export function describePlan(strategy, markets = []) {
  if (!strategy?.steps?.length) return "";
  const find = (id) => markets.find((m) => m.marketId === id);
  const first = strategy.steps[0];
  const watch = marketName(find(first.triggerMarketId)) || "your market";
  const { yes, no } = branchActions(first, find(first.successorMarketId));
  const more = strategy.steps.length > 1
    ? ` It then keeps rolling for ${strategy.steps.length - 1} more settlement${strategy.steps.length > 2 ? "s" : ""}.`
    : " It stops after that one trade.";
  const up = yes.stop ? "stops and places nothing" : `${yes.verb} for ${yes.size}`;
  const down = no.stop ? "stops and places nothing" : `${no.verb} for ${no.size}`;
  if (yes.stop && no.stop) {
    return `As configured this sequence never trades: both results are set to stop. Change one of them to buy a side.`;
  }
  return `When ${watch} settles, Sequence ${up} if it closes up, or ${down} if it closes down.${more} You can never have more than ${money(strategy.maxOutstanding)} at risk at once.`;
}
