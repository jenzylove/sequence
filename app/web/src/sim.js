// Mirror of SequenceVault._winner, the branch mapping, idempotency and both
// caps. If this diverges from src/SequenceVault.sol the simulation lies, so the
// logic is kept line-for-line equivalent.
import { notionalOf } from "./strategy.js";

export const KIND_LABEL = { 0: "Buy YES", 1: "Sell YES", 2: "Buy NO", 3: "Sell NO" };

export function winner(nums, voided) {
  if (voided || nums.length === 0 || nums.length > 2) return 255;
  let maxv = 0n;
  for (const n of nums) if (n > maxv) maxv = n;
  if (maxv === 0n) return 255;
  let idx = 255;
  let count = 0;
  nums.forEach((n, i) => { if (n === maxv) { count++; idx = i; } });
  return count === 1 ? idx : 255;
}

export function kindFor(win, buyYesOnWin0) {
  if (win === 255) return null;
  if (win === 0) return buyYesOnWin0 ? 0 : 2;
  return buyYesOnWin0 ? 2 : 0;
}

// Turn genuine settled markets from the indexer into the resolution stream the
// vault would have consumed from OracleHub.
export function resolutionsFromMarkets(markets) {
  return markets
    .filter((m) => m.finalized || m.voided)
    .map((m) => ({
      marketId: m.marketId,
      questionId: m.questionId ? m.questionId.toString() : "0",
      payoutNumerators: m.payoutNumerators || [],
      voided: Boolean(m.voided),
      question: m.question,
      asset: m.asset,
      resolvedAt: m.resolvedAt,
    }));
}

export function simulate(strategy, resolutions) {
  const events = [];
  const consumed = new Set();
  let outstanding = 0n;

  const byMarket = {};
  for (const step of strategy.steps) {
    if (step.triggerMarketId) byMarket[step.triggerMarketId.toLowerCase()] = step;
  }

  for (const r of resolutions) {
    const ck = `${r.marketId.toLowerCase()}:${r.questionId}`;
    if (consumed.has(ck)) continue;
    consumed.add(ck);

    const step = byMarket[r.marketId.toLowerCase()];
    if (!step) continue;

    const win = winner(r.payoutNumerators, r.voided);
    const kind = kindFor(win, step.buyYesOnWin0);
    if (kind === null) {
      events.push({ stepKey: step.key, marketId: r.marketId, action: "SKIPPED", reason: r.voided ? "voided" : "no clean winner", source: r.source });
      continue;
    }
    const n = notionalOf(step);
    if (n > step.notionalCap) {
      events.push({ stepKey: step.key, marketId: r.marketId, action: "SKIPPED", reason: "step cap", source: r.source });
      continue;
    }
    if (outstanding + n > strategy.maxOutstanding) {
      events.push({ stepKey: step.key, marketId: r.marketId, action: "SKIPPED", reason: "vault cap", source: r.source });
      continue;
    }
    outstanding += n;
    events.push({ stepKey: step.key, marketId: r.marketId, action: "EXECUTED", kind, notional: n, winningOutcome: win, source: r.source });
  }

  return { events, committed: outstanding, headroom: strategy.maxOutstanding - outstanding };
}

// Both branches of one step, so the builder can show what each outcome does
// before anything settles.
export function branchPreview(strategy, step) {
  const rows = [];
  for (const win of [0, 1]) {
    const kind = kindFor(win, step.buyYesOnWin0);
    const n = notionalOf(step);
    let outcome;
    if (n > step.notionalCap) outcome = { action: "SKIPPED", reason: "step cap" };
    else if (n > strategy.maxOutstanding) outcome = { action: "SKIPPED", reason: "vault cap" };
    else outcome = { action: "EXECUTED", kind, notional: n };
    rows.push({ win, ...outcome });
  }
  rows.push({ win: 255, action: "SKIPPED", reason: "voided" });
  return rows;
}

export const fmt = (raw) => "$" + (Number(raw) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 });
export const fmtTime = (unix) => (unix ? new Date(unix * 1000).toUTCString().slice(17, 22) : "—");
