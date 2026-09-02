// The Sequence strategy graph. On-chain the vault executes ONE step at a time;
// this model is the full plan the planner walks, arming each step as the prior
// completes. Kept deliberately close to the SequenceVault.Step struct so the
// planner can arm directly from a node.

export type Kind = 0 | 1 | 2 | 3; // BUY_YES, SELL_YES, BUY_NO, SELL_NO

export type Branch = "onWin0" | "onWin1" | "always" | "onVoid";

export interface StepNode {
  id: string;                 // stepId (bytes32-able)
  triggerMarketId: string;    // resolution that drives this step
  pool: string;               // successor BinaryPool
  price: bigint;              // raw limit price
  quantity: bigint;           // raw size
  orderType: 0 | 1 | 2 | 3;   // IOC=2 default
  buyYesOnWin0: boolean;      // branch->kind mapping (matches vault)
  notionalCap: bigint;        // per-step cap (price*qty must be <=)
  // graph edges: which step to arm next after THIS one resolves
  next?: { onExecuted?: string; onSkipped?: string };
}

export interface Strategy {
  name: string;
  entryStepId: string;
  steps: Record<string, StepNode>;
  bankroll: bigint;           // total tUSDC committed to the vault (raw)
  maxOutstanding: bigint;     // vault-wide notional cap
}

export function notional(s: StepNode): bigint { return s.price * s.quantity; }

// Validate a strategy the SAME way the vault will, so arming never reverts.
export function validate(strat: Strategy): string[] {
  const errs: string[] = [];
  if (!strat.steps[strat.entryStepId]) errs.push(`entryStepId ${strat.entryStepId} not in steps`);
  let totalCap = 0n;
  for (const [id, s] of Object.entries(strat.steps)) {
    if (s.id !== id) errs.push(`step ${id}: id field mismatch (${s.id})`);
    if (s.price <= 0n || s.quantity <= 0n) errs.push(`step ${id}: price/qty must be > 0`);
    if (notional(s) > s.notionalCap) errs.push(`step ${id}: notional ${notional(s)} > cap ${s.notionalCap}`);
    totalCap += s.notionalCap;
    for (const nid of [s.next?.onExecuted, s.next?.onSkipped]) {
      if (nid && !strat.steps[nid]) errs.push(`step ${id}: next ${nid} not found`);
    }
  }
  if (strat.maxOutstanding > strat.bankroll)
    errs.push(`maxOutstanding ${strat.maxOutstanding} exceeds bankroll ${strat.bankroll}`);
  return errs;
}
