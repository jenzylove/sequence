import { Strategy, StepNode, notional } from "./model.js";
import { winner, kindFor } from "./resolve.js";

export interface Resolution {
  marketId: string;
  // string-safe: oracle question ids exceed Number precision
  questionId: number | string;
  payoutNumerators: bigint[];
  voided: boolean;
}

export interface SimEvent {
  stepId: string;
  marketId: string;
  action: "EXECUTED" | "SKIPPED";
  reason?: string;
  kind?: number;
  notional?: bigint;
}

export interface SimResult {
  events: SimEvent[];
  committedNotional: bigint;
  capBreaches: number;
  ok: boolean;
}

// Walk the strategy against a stream of resolutions, enforcing the SAME caps and
// idempotency the vault does. Pure function: no chain, no funds.
export function simulate(strat: Strategy, resolutions: Resolution[]): SimResult {
  const events: SimEvent[] = [];
  const consumed = new Set<string>();
  let outstanding = 0n;
  let capBreaches = 0;

  // index steps by trigger market for O(1) lookup, like stepForMarket
  const byMarket: Record<string, StepNode> = {};
  for (const s of Object.values(strat.steps)) byMarket[s.triggerMarketId.toLowerCase()] = s;

  for (const r of resolutions) {
    const ck = `${r.marketId.toLowerCase()}:${r.questionId}`;
    if (consumed.has(ck)) continue;
    consumed.add(ck);

    const step = byMarket[r.marketId.toLowerCase()];
    if (!step) continue;

    const win = winner(r.payoutNumerators, r.voided);
    const kind = kindFor(win, step.buyYesOnWin0);
    if (kind === null) {
      events.push({ stepId: step.id, marketId: r.marketId, action: "SKIPPED", reason: r.voided ? "voided" : "no-clean-winner" });
      continue;
    }
    const n = notional(step);
    if (n > step.notionalCap) { capBreaches++; events.push({ stepId: step.id, marketId: r.marketId, action: "SKIPPED", reason: "step-cap" }); continue; }
    if (outstanding + n > strat.maxOutstanding) { capBreaches++; events.push({ stepId: step.id, marketId: r.marketId, action: "SKIPPED", reason: "vault-cap" }); continue; }

    outstanding += n;
    events.push({ stepId: step.id, marketId: r.marketId, action: "EXECUTED", kind, notional: n });
  }

  return { events, committedNotional: outstanding, capBreaches, ok: outstanding <= strat.maxOutstanding };
}
