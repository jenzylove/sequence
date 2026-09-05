// A real Sequence run, replayed.
//
// Every hash, id and amount below was read off Somnia Shannon from one recorded
// run and its redemption. Nothing here is illustrative — each stage links to the
// transaction that produced it, so the demo is checkable rather than promised.
//
// Source: docs/LIVE_FIRE.json run 2 and docs/REDEMPTION.json.
export const DEMO_VAULT = "0x0185CA254C9e7b184b566e7037160334519cC9f6";

export const DEMO_STAGES = [
  {
    key: "watch",
    label: "Watch",
    title: "The sequence waits on a market",
    plain: "A trader set one rule: when the BTC 5-minute market settles, take a position in the next BTC hourly market. Then they closed the tab.",
    detail: "The rule now lives in their own account on Somnia. It cannot spend more than the limit they set, and only their wallet can change or cancel it.",
    facts: [
      ["Watching", "BTC 5m"],
      ["Then trades", "BTC 1h"],
      ["Most at risk", "$2.00"],
    ],
    tx: "0x3a92978d189175f8e1e98fae1183ec3af1963d97892e206b697c57b1dd73d64d",
    txLabel: "The rule going live",
  },
  {
    key: "settlement",
    label: "Settlement",
    title: "The market settles",
    plain: "The BTC 5-minute market closed and the oracle published its answer. Nobody was watching the screen.",
    detail: "The account reads the result from the market contract itself rather than being told what happened, so it cannot be fed a false outcome.",
    facts: [
      ["Market", "BTC 5m"],
      ["Result", "Read from chain"],
      ["Human input", "None"],
    ],
    tx: "0x07adeb99a88de732c7b4bf191472679925421f4626aad53f9021fa79a5372a94",
    txLabel: "The settlement reaching the account",
  },
  {
    key: "branch",
    label: "Branch",
    title: "The rule picks a side",
    plain: "The outcome decided which side of the next market to buy. The trader had set both branches in advance: one for each way the market could go.",
    detail: "Either branch can also be set to stop, which places nothing and ends the sequence. Whichever way it goes, the account acts on the outcome it read, not on a prediction.",
    facts: [
      ["Branch taken", "Buy NO"],
      ["Alternative", "Buy YES"],
      ["Third option", "Stop"],
    ],
    tx: "0x07adeb99a88de732c7b4bf191472679925421f4626aad53f9021fa79a5372a94",
    txLabel: "The branch being taken",
  },
  {
    key: "order",
    label: "Order",
    title: "The order goes on the book",
    plain: "The account placed a real order in the next market, priced to cross the live book, and never larger than the trader's limit.",
    detail: "If the pool had refused the order, the account would have recorded that plainly as skipped rather than claiming a trade it did not make.",
    facts: [
      ["Order", "$1.9996"],
      ["Order id", "110680464442257315396"],
      ["Limit", "$2.00"],
    ],
    tx: "0x07adeb99a88de732c7b4bf191472679925421f4626aad53f9021fa79a5372a94",
    txLabel: "The order being placed",
  },
  {
    key: "redemption",
    label: "Redemption",
    title: "The win turns back into money",
    plain: "The hourly market settled and the position won. Redeeming turned it back into spendable funds, ready for the next sequence.",
    detail: "Until a won position is redeemed it is not money — it is a token in a market that has already finished. This is the step that lets a strategy keep rolling instead of quietly running out of funds.",
    facts: [
      ["Position", "4.366 NO"],
      ["Returned", "$4.3660"],
      ["Balance", "$198.07 → $202.44"],
    ],
    tx: "0xb7cc85e283b290886e83f242e123a599ca68804c588a0148fb785bada4823e34",
    txLabel: "The redemption",
  },
];
