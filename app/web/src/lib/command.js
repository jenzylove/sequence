// Turns a plain-English instruction into the SAME structured strategy the manual
// builder edits. Two rules govern this file:
//
//   1. It never invents market data. Every market it references is one the
//      indexer actually returned; if nothing matches, it says so and stops.
//   2. It never forms a view on price. It maps the words "if it wins" and
//      "roll it" onto rules; it does not decide whether BTC goes up.
//
// The parse is deterministic and local, so what the user reads back is exactly
// what will be encoded on chain.
import { makeStep, emptyStrategy, notionalOf } from "../strategy.js";
import { marketHeadline, money } from "./language.js";

const ASSETS = [
  { key: "BTC", match: /\b(btc|bitcoin)\b/i },
  { key: "ETH", match: /\b(eth|ether|ethereum)\b/i },
];

const money$ = (text, patterns) => {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const value = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(value) && value > 0) return BigInt(Math.round(value * 1e6));
    }
  }
  return null;
};

// "3 steps", "four legs", "roll it twice", "once", "a couple of rounds"
const WORD_COUNT = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const PLAIN_COUNT = { once: 1, twice: 2, thrice: 3, "a couple": 2, "a few": 3 };
function parseCount(text) {
  const digits = text.match(/\b(\d+)\s*(?:steps?|legs?|trades?|rounds?|times)\b/i);
  if (digits) return Math.min(6, Math.max(1, Number(digits[1])));
  const words = text.match(/\b(one|two|three|four|five|six)\s*(?:steps?|legs?|trades?|rounds?|times)\b/i);
  if (words) return WORD_COUNT[words[1].toLowerCase()];
  // bare multiplier words, with or without a following noun
  const plain = text.match(/\b(once|twice|thrice)\b/i);
  if (plain) return PLAIN_COUNT[plain[1].toLowerCase()];
  const loose = text.match(/\b(a couple|a few)\b/i);
  if (loose) return PLAIN_COUNT[loose[1].toLowerCase()];
  // a bare number next to the asset, e.g. "roll BTC 3"
  const bare = text.match(/\b(\d+)\s*(?:more|follow[- ]?ons?)?\s*$/i);
  if (bare && Number(bare[1]) <= 6) return Math.max(1, Number(bare[1]));
  if (/\broll(ing)?\b/i.test(text)) return 3;
  return 2;
}

function parseAsset(text) {
  for (const a of ASSETS) if (a.match.test(text)) return a.key;
  return null;
}

// Which way to lean when the watched market lands YES.
function parseDirection(text) {
  if (/\b(buy|go|take)\s+no\b/i.test(text) || /\bfade\b/i.test(text) || /\bagainst\b/i.test(text)) return false;
  if (/\bopposite\b/i.test(text) || /\breverse\b/i.test(text) || /\binvert\b/i.test(text)) return false;
  return true;
}

export function parseCommand(text, { open = [], bankroll = 200000000n, accountLimit = null } = {}) {
  const notes = [];
  const raw = (text || "").trim();
  if (raw.length < 4) {
    return { ok: false, reason: "Tell me what you want to happen, for example: roll BTC three times, $2 a trade, $5 total." };
  }

  const asset = parseAsset(raw);
  if (!asset) {
    return { ok: false, reason: "Name the market you want to follow. Right now Sequence runs on the rolling BTC and ETH markets." };
  }

  // Only ever choose from markets the indexer actually returned.
  const pool = open.filter((m) => m.asset === asset).sort((a, b) => (a.expiry || 0) - (b.expiry || 0));
  if (pool.length < 2) {
    return {
      ok: false,
      reason: `There are not enough ${asset} markets open right now to chain together. ${pool.length === 1 ? "Only one is trading." : "None are trading."} Try again when the next windows open.`,
    };
  }

  const requested = parseCount(raw);
  const count = Math.min(requested, pool.length - 1);
  if (count < requested) notes.push(`Only ${pool.length} ${asset} markets are open, so I built ${count} step${count > 1 ? "s" : ""} instead of ${requested}.`);

  // "$2 a trade", "$3 each", "with $3", "risk $1 per leg"
  const perTrade = money$(raw, [
    /\$\s*([\d.,]+)\s*(?:a|per|each|apiece|max)?\s*(?:per\s*)?(?:trade|step|leg|bet|round)\b/i,
    /\$\s*([\d.,]+)\s*(?:each|apiece|a piece|per pop)\b/i,
    /(?:risk|stake|size|bet|use|with|of)\s*(?:up to\s*)?\$\s*([\d.,]+)/i,
  ]);
  const total = money$(raw, [
    /\$\s*([\d.,]+)\s*(?:in\s*)?(?:total|overall|max(?:imum)?|all in|altogether)/i,
    /(?:total|overall|cap|limit|max(?:imum)?)\s*(?:of\s*)?\$\s*([\d.,]+)/i,
  ]);

  const perStepCap = perTrade || 2000000n;
  if (!perTrade) notes.push("You did not set a size, so I used $2.00 a trade. Change it before you go live.");

  const maxOutstanding = total || perStepCap * BigInt(count);
  if (!total) notes.push(`Total risk limit set to ${money(maxOutstanding)}, which is ${count} × ${money(perStepCap)}.`);
  if (accountLimit !== null && maxOutstanding > accountLimit) {
    notes.push(`Your account will not risk more than ${money(accountLimit)} at once, so it will stand down anything past that. Raise the limit on your desk to use the full ${money(maxOutstanding)}.`);
  }

  const buyYesOnWin0 = parseDirection(raw);

  // Price: binary contracts are quoted 0-1. Use the market's own last traded
  // price where the indexer has one, so the ticket starts from a real level.
  const strategy = emptyStrategy();
  strategy.name = `${asset} rolling sequence`;
  strategy.bankroll = bankroll;
  strategy.maxOutstanding = maxOutstanding;
  strategy.steps = [];

  for (let i = 0; i < count; i++) {
    const triggerMarket = pool[i];
    const successorMarket = pool[i + 1];
    const step = makeStep(i + 1, { triggerMarket, successorMarket });
    const reference = successorMarket.lastPrice && successorMarket.lastPrice > 0n ? successorMarket.lastPrice : 500000n;
    // Size the order so its value lands inside the per-trade cap.
    const quantity = reference > 0n ? perStepCap / reference : 1n;
    step.price = reference;
    step.quantity = quantity > 0n ? quantity : 1n;
    step.notionalCap = perStepCap;
    step.buyYesOnWin0 = buyYesOnWin0;
    step.orderType = 2;
    strategy.steps.push(step);
  }

  // If rounding pushed a step over its cap, pull the size back by one lot.
  for (const step of strategy.steps) {
    while (step.quantity > 1n && notionalOf(step) > step.notionalCap) step.quantity -= 1n;
  }

  const overCap = strategy.steps.reduce((sum, s) => sum + notionalOf(s), 0n);
  if (overCap > maxOutstanding) {
    notes.push(`If every step fires it would commit ${money(overCap)}, past your ${money(maxOutstanding)} limit. Sequence will stand down the steps that would cross it.`);
  }

  const first = pool[0];
  const summary = `Follow ${marketHeadline(first)}. ${count === 1 ? "One follow-on trade" : `Up to ${count} follow-on trades`}, ${money(perStepCap)} each, ${money(maxOutstanding)} at risk in total.`;

  return { ok: true, strategy, notes, summary, asset, count, perStepCap, maxOutstanding };
}

// ---------------------------------------------------------------------------
// Plain-language answers about what is happening right now. Reads state; it
// does not speculate.

export function explainState({ vaultState, steps = [], markets = [], now = Date.now() }) {
  if (!vaultState) return "I am still reading your account from the network.";

  const live = steps.filter((s) => s.exists && ["ARMED", "WAITING", "TRIGGERED"].includes(s.statusLabel));
  const lines = [];

  if (vaultState.paused) {
    lines.push("Everything is on hold: you paused trading, so no settlement will start a trade until you resume.");
  }
  if (!vaultState.subscribed) {
    lines.push("Your account is not yet listening for settlements, so nothing will run automatically. Finish setup to switch it on.");
  }

  if (live.length === 0) {
    lines.push("Nothing is live right now. Describe a sequence and I will set it up.");
  } else {
    const s = live[0];
    const market = markets.find((m) => m.marketId?.toLowerCase() === s.triggerMarketId?.toLowerCase());
    const when = market?.expiry ? ` It settles ${relative(market.expiry, now)}.` : "";
    lines.push(
      `${live.length === 1 ? "One sequence is" : `${live.length} sequences are`} live. ` +
      `The next one is waiting on ${market ? marketHeadline(market) : "its market"}.${when} ` +
      `If it lands YES it buys ${s.buyYesOnWin0 ? "YES" : "NO"} next, risking at most ${money(s.notionalCap)}.`,
    );
  }

  const headroom = vaultState.maxOutstanding - vaultState.outstanding;
  lines.push(`You have ${money(vaultState.outstanding)} committed against a ${money(vaultState.maxOutstanding)} limit, so ${money(headroom)} is still free.`);

  return lines.join(" ");
}

const relative = (unix, now) => {
  const delta = unix * 1000 - now;
  if (delta <= 0) return "any moment";
  const m = Math.round(delta / 60000);
  return m < 1 ? "in under a minute" : m === 1 ? "in about a minute" : `in about ${m} minutes`;
};

// Why a particular thing happened, from a real decoded event.
export function explainEvent(event) {
  const a = event.args || {};
  switch (event.name) {
    case "StepArmed":
      return "You put this sequence live. From here it runs on its own.";
    case "Triggered":
      return a.voided
        ? "The market was cancelled, so there was no result to act on."
        : `The market settled on outcome ${a.winningOutcome}. Sequence read the result and moved to your rule.`;
    case "Executed":
      return a.success
        ? `Your follow-on trade went in for ${money(a.notional)}.`
        : `Sequence tried to place your follow-on trade for ${money(a.notional)}, but the market did not accept it. Nothing else was risked.`;
    case "Skipped":
      return `Sequence stood down: ${a.reason}. Nothing was risked.`;
    case "StepCancelled":
      return "You called this sequence off before it ran.";
    case "PausedSet":
      return a.paused ? "You paused trading." : "You resumed trading.";
    default:
      return "";
  }
}
