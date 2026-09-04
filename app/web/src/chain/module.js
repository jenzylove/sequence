// Direct reads of the DreamDEX BinaryMarketsModule.
//
// The indexer is what makes the interface fast, but it can lag, and a sequence
// arms a market now and trades into it minutes later. Anything that gates real
// money is confirmed against the module itself before the user signs.
import { publicClient } from "./vault.js";
import { SHANNON } from "./config.js";

export const moduleAbi = [
  {
    type: "function", stateMutability: "view", name: "markets",
    inputs: [{ type: "bytes32" }],
    outputs: [
      { type: "uint256", name: "oracleQuestionId" },
      { type: "uint8", name: "outcomeSlotCount" },
      { type: "uint8", name: "voidPolicy" },
      { type: "address", name: "collateral" },
      { type: "uint32", name: "originOperatorId" },
      { type: "bytes32", name: "originVenueId" },
      { type: "address", name: "oracleAdapter" },
      { type: "address", name: "creator" },
      { type: "address", name: "market" },
      { type: "address", name: "pool" },
      { type: "uint256", name: "yesId" },
      { type: "uint256", name: "noId" },
      { type: "uint64", name: "tradingStart" },
      { type: "uint64", name: "expiry" },
    ],
  },
];

export async function readMarketOnchain(marketId) {
  const raw = await publicClient().readContract({
    address: SHANNON.binaryModule, abi: moduleAbi, functionName: "markets", args: [marketId],
  });
  const [questionId, , , collateral, , , , , market, pool, , , tradingStart, expiry] = raw;
  return {
    marketId,
    questionId,
    collateral,
    market,
    pool,
    tradingStart: Number(tradingStart),
    expiry: Number(expiry),
    exists: pool !== "0x0000000000000000000000000000000000000000",
  };
}

// Is this market still something we can safely trade into? Returns the reasons
// it is not, in words a trader can act on.
export async function checkTradable(marketId, expectedPool, now = Date.now()) {
  const problems = [];
  let onchain = null;
  try {
    onchain = await readMarketOnchain(marketId);
  } catch {
    return { ok: false, onchain: null, problems: ["Could not confirm this market on the network."] };
  }

  if (!onchain.exists) {
    problems.push("The network has no record of this market.");
  }
  if (expectedPool && onchain.pool && expectedPool.toLowerCase() !== onchain.pool.toLowerCase()) {
    // Pools are recycled between windows, so a stale pool is a real risk.
    problems.push("This market now trades on a different pool than the one recorded.");
  }
  const seconds = Math.floor(now / 1000);
  if (onchain.expiry && onchain.expiry <= seconds) {
    problems.push("This market has already closed.");
  }
  return { ok: problems.length === 0, onchain, problems };
}
