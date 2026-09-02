#!/usr/bin/env bash
set -euo pipefail
echo ">> product: strategy model + simulator (off-chain planner)"

mkdir -p app/planner

# --- strategy model: the multi-step graph a Sequence actually is ---
cat > app/planner/model.ts << 'TS'
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
TS

# --- resolution decode: SAME winner logic as the vault (no divergence allowed) ---
cat > app/planner/resolve.ts << 'TS'
// Mirror of SequenceVault._winner. If these diverge, sim lies. Keep identical.
export function winner(payoutNumerators: bigint[], voided: boolean): number {
  if (voided || payoutNumerators.length === 0 || payoutNumerators.length > 2) return 255;
  let maxv = 0n;
  for (const n of payoutNumerators) if (n > maxv) maxv = n;
  if (maxv === 0n) return 255;
  let idx = 255, count = 0;
  payoutNumerators.forEach((n, i) => { if (n === maxv) { count++; idx = i; } });
  return count === 1 ? idx : 255;
}

// Mirror of the vault's win->kind branch.
export function kindFor(win: number, buyYesOnWin0: boolean): number | null {
  if (win === 255) return null;
  if (win === 0) return buyYesOnWin0 ? 0 : 2;
  return buyYesOnWin0 ? 2 : 0;
}
TS

# --- the simulator: replay real resolutions from the indexer ---
cat > app/planner/simulate.ts << 'TS'
import { Strategy, StepNode, notional } from "./model.js";
import { winner, kindFor } from "./resolve.js";

export interface Resolution {
  marketId: string;
  questionId: number;
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
TS

# --- fetch real historical resolutions from the indexer to simulate against ---
cat > app/planner/fetchResolutions.ts << 'TS'
// Pull real AnswerDelivered-equivalent resolutions from the Somnia markets indexer.
// Used to feed simulate() with genuine on-chain history, not synthetic data.
const INDEXER = "https://dev.smk.somnia.host/v1/graphql";

export async function fetchRecentResolutions(limit = 50): Promise<any[]> {
  const query = `
    query Recent($limit: Int!) {
      Market(where: {status: {_in: [4,5]}}, order_by: {expiry: desc}, limit: $limit) {
        market_id
        oracle_question_id
        status
      }
    }`;
  const res = await fetch(INDEXER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { limit } }),
  });
  const json = await res.json();
  if (json.errors) throw new Error("indexer: " + JSON.stringify(json.errors));
  return json.data?.Market ?? [];
}
TS

# --- a runnable sim demo over a tiny hand-built strategy ---
cat > app/planner/demo.ts << 'TS'
import { Strategy } from "./model.js";
import { simulate, Resolution } from "./simulate.js";
import { validate } from "./model.js";

// A 2-step Sequence: if market A resolves YES, buy YES on pool P2 (step2).
const strat: Strategy = {
  name: "demo-2step",
  entryStepId: "step1",
  bankroll: 10_000000n,        // 10 tUSDC
  maxOutstanding: 5_000000n,   // cap 5 tUSDC
  steps: {
    step1: { id: "step1", triggerMarketId: "0xAAA", pool: "0xPOOL2", price: 600000n, quantity: 5n, orderType: 2, buyYesOnWin0: true, notionalCap: 4_000000n, next: { onExecuted: "step2" } },
    step2: { id: "step2", triggerMarketId: "0xBBB", pool: "0xPOOL3", price: 500000n, quantity: 4n, orderType: 2, buyYesOnWin0: false, notionalCap: 3_000000n },
  },
};

const errs = validate(strat);
console.log("validation:", errs.length ? errs : "OK");

const resolutions: Resolution[] = [
  { marketId: "0xAAA", questionId: 1, payoutNumerators: [1n, 0n], voided: false }, // YES wins -> execute step1
  { marketId: "0xAAA", questionId: 1, payoutNumerators: [1n, 0n], voided: false }, // duplicate -> ignored (idempotent)
  { marketId: "0xBBB", questionId: 2, payoutNumerators: [0n, 0n], voided: true },  // void -> skip step2
];

const result = simulate(strat, resolutions);
console.log(JSON.stringify(result, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2));
TS

# package.json for the app layer (ESM + tsx runner)
cat > app/package.json << 'JSON'
{
  "name": "sequence-app",
  "private": true,
  "type": "module",
  "scripts": {
    "sim": "tsx planner/demo.ts",
    "resolutions": "tsx -e \"import('./planner/fetchResolutions.js').then(m=>m.fetchRecentResolutions(10)).then(r=>console.log(r))\""
  },
  "devDependencies": { "tsx": "^4.19.0", "typescript": "^5.6.0" }
}
JSON

echo ">> installing app deps + running the simulator demo"
cd app
npm install >/dev/null 2>&1
npx tsx planner/demo.ts
