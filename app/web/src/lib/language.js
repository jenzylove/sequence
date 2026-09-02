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

// A market's question, shortened to something scannable.
export function marketHeadline(market) {
  if (!market) return "a market";
  const asset = market.asset || "Market";
  const q = market.question || "";
  if (/closes at or above its opening price/i.test(q)) return `${asset} closes up`;
  const strike = q.match(/at or above ([\d,.]+)/i);
  if (strike) return `${asset} above ${Number(strike[1].replace(/,/g, "")).toLocaleString()}`;
  return `${asset} market`;
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

export const money = (raw, decimals = 6) =>
  "$" + (Number(raw) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: 2 });

// Binary market prices are quoted 0-1 in collateral terms; traders read them as odds.
export const asOdds = (raw) => (raw === null || raw === undefined ? null : Math.round((Number(raw) / 1e6) * 100));

// One sentence describing what a whole step will do, in trader language.
export function describeStep(step, { triggerMarket, successorMarket } = {}) {
  const watch = marketHeadline(triggerMarket) || step.triggerLabel || "your chosen market";
  const then = marketHeadline(successorMarket) || step.successorLabel || "the next market";
  const yes = step.buyYesOnWin0 ? "YES" : "NO";
  const no = step.buyYesOnWin0 ? "NO" : "YES";
  return `When ${watch} settles: if it lands YES, buy ${yes} on ${then}. If it lands NO, buy ${no} instead. Either way you risk at most ${money(step.notionalCap)}.`;
}
