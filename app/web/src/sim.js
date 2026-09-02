// Mirror of SequenceVault._winner + branch + caps. Keep identical to Solidity.
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

export function simulate(strat, resolutions) {
  const events = [];
  const consumed = new Set();
  let outstanding = 0n;
  const byMarket = {};
  for (const s of strat.steps) byMarket[s.triggerMarketId.toLowerCase()] = s;
  for (const r of resolutions) {
    const ck = r.marketId.toLowerCase() + ":" + r.questionId;
    if (consumed.has(ck)) continue;
    consumed.add(ck);
    const step = byMarket[r.marketId.toLowerCase()];
    if (!step) continue;
    const win = winner(r.payoutNumerators, r.voided);
    const kind = kindFor(win, step.buyYesOnWin0);
    if (kind === null) {
      events.push({ stepId: step.id, action: "SKIPPED", reason: r.voided ? "voided" : "no clean winner" });
      continue;
    }
    const n = step.price * step.quantity;
    if (n > step.notionalCap) {
      events.push({ stepId: step.id, action: "SKIPPED", reason: "step cap" });
      continue;
    }
    if (outstanding + n > strat.maxOutstanding) {
      events.push({ stepId: step.id, action: "SKIPPED", reason: "vault cap" });
      continue;
    }
    outstanding += n;
    events.push({ stepId: step.id, action: "EXECUTED", kind, notional: n });
  }
  return { events, committed: outstanding };
}

export const fmt = (raw) => "$" + (Number(raw) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 });
