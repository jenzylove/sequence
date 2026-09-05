// A step watches one market and trades into another. Everything about finding a
// redeemable position depends on telling those two apart, and an earlier version
// of this code did not: it read the trigger market off `Triggered` and so looked
// for outcome tokens in a market where none can ever be held.
//
// These tests pin the distinction. The chain is mocked so the shape of the bug
// is what is under test, not the network.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Market A is watched. Market B is traded into and is where tokens live.
const A = "0x" + "00".repeat(29) + "013c18";
const B = "0x" + "00".repeat(29) + "013bc6";
const STEP = "0x" + "11".repeat(32);
const VAULT = "0x0185CA254C9e7b184b566e7037160334519cC9f6";
const TOKEN = "0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9";

const YES_ID = 1n << 8n;      // marketKey(yesId) = yesId >> 8
const NO_ID = YES_ID + 1n;

// The vault's log: it was triggered by A, and placed into the successor.
const events = [
  { name: "StepArmed", args: { stepId: STEP, triggerMarketId: A } },
  { name: "Triggered", args: { stepId: STEP, marketId: A } },
  { name: "Placed", args: { stepId: STEP, orderId: 1n } },
];

// The stored step: watches A, successor is B.
const step = { triggerMarketId: A, successorMarketId: B };

const balances = { [YES_ID.toString()]: 0n, [NO_ID.toString()]: 4_366_000n };

mock.module("./chain/vault.js", {
  exports: {
    readVaultEvents: async () => events,
    publicClient: () => ({
      readContract: async ({ functionName, args }) => {
        if (functionName === "steps") return step;
        if (functionName === "markets") {
          // The module's record tuple; only the fields we read matter.
          return [0n, 0, 0, TOKEN, 0, "0x", "0x", "0x", "0xMarketB", "0xPoolB", YES_ID, NO_ID, 0n, 0n];
        }
        if (functionName === "getSettlement") {
          return { collateralToken: TOKEN, backing: 0n, finalized: true, voided: false,
                   settlementFeeBpsTimes1k: 0n, feeRecipient: "0x", pool: "0x", nonce: 0n,
                   payoutNumerators: [0n, 10_000_000n] };   // outcome 1 (NO) won
        }
        if (functionName === "outcomeToken") return TOKEN;
        if (functionName === "balanceOf") return balances[args[1].toString()] ?? 0n;
        throw new Error("unexpected read: " + functionName);
      },
    }),
  },
});

// The settled feed does not know about B, so discovery must come from the vault.
mock.module("./chain/markets.js", {
  exports: { fetchResolvedMarkets: async () => [] },
});

const { tradedMarketIds, findClaimablePositions } = await import("./chain/positions.js");

test("a traded market is the successor, never the trigger", async () => {
  const ids = await tradedMarketIds(VAULT);
  assert.deepEqual(ids, [B], "the market the position lives in is the successor");
  assert.ok(!ids.includes(A), "the watched market must never be searched for tokens");
});

test("a redeemable position in the successor is discovered", async () => {
  const found = await findClaimablePositions(VAULT);
  assert.equal(found.length, 1, "the position must be surfaced");
  assert.equal(found[0].marketId, B);
  assert.equal(found[0].claimable, 4_366_000n, "the winning side is claimable in full");
  assert.equal(found[0].worthless, false);
});

test("Collect redeems the market the tokens are in", async () => {
  const [position] = await findClaimablePositions(VAULT);
  // This is the argument the Finished tab hands to redeemPosition.
  assert.equal(position.marketId, B, "redeemPosition must be called with the successor");
});

test("a losing side is surfaced as finished rather than hidden", async () => {
  balances[NO_ID.toString()] = 0n;
  balances[YES_ID.toString()] = 4_366_000n;   // held YES; outcome 1 won
  const [position] = await findClaimablePositions(VAULT);
  assert.equal(position.marketId, B);
  assert.equal(position.claimable, 0n);
  assert.equal(position.worthless, true, "a trader should still see it is there and finished");
  balances[NO_ID.toString()] = 4_366_000n;
  balances[YES_ID.toString()] = 0n;
});
