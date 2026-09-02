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
