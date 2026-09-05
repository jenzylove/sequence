// A real Sequence run, replayed.
//
// Every hash, id and amount below was read off Somnia Shannon. Nothing here is
// illustrative — each stage links to the transaction that produced it.
//
// Stages 1-4 are one run, and it is the autonomous one: the account was armed
// and then advanced entirely by Somnia Reactivity, with no `syncResolution` and
// nobody watching. Source: docs/LIVE_FIRE.json run 3 (`advancedBy: "reactivity"`)
// and docs/REACTIVITY_EXPERIMENT.json.
//
// Stage 5 is deliberately NOT presented as part of that run. Run 3's position is
// still open — the market it bought into settles later — so there is no
// redemption to show from it. Rather than blur two runs into one story, the
// redemption is shown as what it is: a separately proven step, from an earlier
// run on the same account (docs/REDEMPTION.json).
export const DEMO_VAULT = "0x0185CA254C9e7b184b566e7037160334519cC9f6";

export const DEMO_STAGES = [
  {
    key: "watch",
    label: "Watch",
    title: "The sequence waits on a market",
    plain: "A trader set one rule: when the ETH hourly market settles, take a position in the next ETH daily market. Then they closed the tab.",
    detail: "The rule lives in their own account on Somnia. It cannot spend more than the limit they set, and only their wallet can change or cancel it.",
    facts: [
      ["Watching", "ETH 1h"],
      ["Then trades", "ETH 1d"],
      ["Most at risk", "$2.00"],
    ],
    tx: "0x04707f13daa4003ce282b89230fcfa06fa777dd6037b6f4d85125e90c85952f0",
    txLabel: "The rule going live",
  },
  {
    key: "settlement",
    label: "Settlement",
    title: "The network wakes the account up",
    plain: "The ETH hourly market settled. Somnia pushed that result straight into the account — no human, no script, nothing polling.",
    detail: "The oracle published its answer and Somnia's Reactivity precompile called the account's handler in the same block. In that block it made eight such calls, none of which reverted.",
    facts: [
      ["Delivered by", "Somnia Reactivity"],
      ["Block", "480220742"],
      ["Human input", "None"],
    ],
    tx: "0xdbff2003deb11bb3784a459819f3472e6a04751cc513e68d97cdf4ffb9a3beb9",
    txLabel: "The account being woken by the network",
  },
  {
    key: "branch",
    label: "Branch",
    title: "The rule picks a side",
    plain: "The outcome decided which side of the next market to buy. The trader had set both branches in advance: one for each way the market could go.",
    detail: "Either branch can also be set to stop, which places nothing and ends the sequence. Here the hourly market resolved YES, so the branch for YES was taken.",
    facts: [
      ["Outcome", "YES"],
      ["Branch taken", "Buy YES"],
      ["Third option", "Stop"],
    ],
    tx: "0xdbff2003deb11bb3784a459819f3472e6a04751cc513e68d97cdf4ffb9a3beb9",
    txLabel: "The branch being taken",
  },
  {
    key: "order",
    label: "Order",
    title: "The order goes on the book",
    plain: "The account placed a real order in the ETH daily market, priced to cross the live book, and never larger than the trader's limit.",
    detail: "If the pool had refused the order, the account would have recorded that plainly as skipped rather than claiming a trade it did not make. This position is still open — the daily market has not settled yet.",
    facts: [
      ["Order", "$1.9999"],
      ["Order id", "110680464442257334685"],
      ["Limit", "$2.00"],
    ],
    tx: "0xdbff2003deb11bb3784a459819f3472e6a04751cc513e68d97cdf4ffb9a3beb9",
    txLabel: "The order being placed",
  },
  {
    key: "redemption",
    label: "Redemption",
    // Flagged so the interface can say out loud that this is a different run.
    separate: true,
    title: "A win turns back into money",
    plain: "This is the one step the run above has not reached yet, because the market it bought into is still open. So here it is from an earlier run on the same account: a market settled, the position won, and redeeming turned it back into spendable funds.",
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
