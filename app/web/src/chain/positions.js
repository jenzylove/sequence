// Claimable positions, read through the official markets SDK.
//
// This is where @somnia-chain/markets-sdk earns its place in the product rather
// than sitting unused in a manifest. Three things here are genuinely easy to get
// wrong by hand, and getting any of them wrong is how a redemption silently
// redeems nothing:
//
//   1. the module's market record tuple, whose field order is not guessable;
//   2. marketKey, the settlement record's key, which is yesId >> 8 rather than
//      the marketId you started with;
//   3. the payout vector, which settlement v3 stores instead of a winner index.
//
// All of that is the SDK's own code and its own address book. The write still
// goes through SequenceVault, because the vault owns the tokens.
import {
  SOMNIA_TESTNET_ADDRESSES,
  binaryModuleReadAbi,
  binarySettlementAbi,
  erc6909Abi,
  marketKey,
} from "@somnia-chain/markets-sdk";
import { publicClient, readVaultEvents } from "./vault.js";
import { vaultAbi } from "./abi.js";
import { fetchResolvedMarkets } from "./markets.js";

export const SDK_ADDRESSES = SOMNIA_TESTNET_ADDRESSES;

// The module's market record, read with the SDK's own ABI. yesId is the 11th
// field; the SDK reads it positionally for exactly the same reason.
export async function readMarketRecord(marketId) {
  const record = await publicClient().readContract({
    address: SOMNIA_TESTNET_ADDRESSES.binaryModule,
    abi: binaryModuleReadAbi,
    functionName: "markets",
    args: [marketId],
  });
  const [questionId, , , collateral, , , , , market, pool, yesId, noId, tradingStart, expiry] = record;
  return {
    marketId, questionId, collateral, market, pool, yesId, noId,
    tradingStart: Number(tradingStart), expiry: Number(expiry),
    known: yesId !== 0n,
  };
}

// The settlement record is the authority on whether anything is redeemable.
// A market can look resolved and still not be finalized, and only a finalized
// record has the payout vector redemption is paid against.
export async function readSettlement(yesId) {
  const client = publicClient();
  const settlement = SOMNIA_TESTNET_ADDRESSES.binarySettlement;
  const [record, outcomeToken] = await Promise.all([
    client.readContract({
      address: settlement, abi: binarySettlementAbi,
      functionName: "getSettlement", args: [marketKey(yesId)],
    }),
    client.readContract({ address: settlement, abi: binarySettlementAbi, functionName: "outcomeToken" }),
  ]);

  const payouts = [...(record.payoutNumerators ?? [])];
  // The winner is the argmax of the payout vector, and only when it is unique.
  // A void is a uniform vector, so uniqueness is what separates the two without
  // trusting the voided flag alone.
  let winner = null;
  if (payouts.length) {
    const max = payouts.reduce((a, b) => (b > a ? b : a), 0n);
    const winners = payouts.map((p, i) => (p === max ? i : -1)).filter((i) => i >= 0);
    if (max > 0n && winners.length === 1) winner = winners[0];
  }
  return {
    finalized: record.finalized, voided: record.voided,
    backing: record.backing, payouts, winner, outcomeToken,
  };
}

// What a vault holds of a market's two outcomes, on the shared singleton.
export async function readOutcomeBalances(vault, { yesId, noId, outcomeToken }) {
  const client = publicClient();
  const [yes, no] = await Promise.all([
    client.readContract({ address: outcomeToken, abi: erc6909Abi, functionName: "balanceOf", args: [vault, yesId] }),
    client.readContract({ address: outcomeToken, abi: erc6909Abi, functionName: "balanceOf", args: [vault, noId] }),
  ]);
  return { yes, no };
}

// Which markets a vault actually holds positions in, from its own events.
//
// The subtlety that matters: a step *watches* one market and *trades into*
// another. `Triggered.marketId` is the trigger, and outcome tokens are never
// held there - they are held in the successor. Reading the trigger would send
// the Finished tab looking in the wrong market and quietly miss a position that
// is genuinely redeemable.
//
// Three sources, all successor-side: the step a `Placed` event points at,
// and the market ids carried directly by `ExposureReleased` and `Redeemed`.
export async function tradedMarketIds(vault, { fromBlock } = {}) {
  const client = publicClient();
  const events = await readVaultEvents({ vault, fromBlock });
  const markets = [];
  const remember = (id) => {
    if (id && !/^0x0+$/.test(id) && !markets.includes(id)) markets.push(id);
  };

  const stepIds = [];
  for (const e of events) {
    if (e.name === "Placed" && e.args?.stepId && !stepIds.includes(e.args.stepId)) stepIds.push(e.args.stepId);
    // These two already name the market the position lives in.
    if (e.name === "ExposureReleased" || e.name === "Redeemed") remember(e.args?.marketId);
  }

  for (const stepId of stepIds) {
    try {
      const step = await client.readContract({
        address: vault, abi: vaultAbi, functionName: "steps", args: [stepId],
      });
      remember(step.successorMarketId ?? step[10]);
    } catch { /* a step we cannot read tells us nothing */ }
  }
  return markets;
}

// Everything a vault could redeem right now.
//
// A losing position is reported as held but worth nothing rather than quietly
// omitted, because a trader wants to know it is there and finished.
export async function findClaimablePositions(vault, { limit = 25, marketIds } = {}) {
  if (!vault) return [];
  // Union of both sources. The vault's own history is precise but only reaches
  // as far back as the node will serve logs; the settled feed is broad but only
  // covers what settled recently. Neither alone is enough.
  const settled = await fetchResolvedMarkets(limit).catch(() => []);
  const meta = new Map(settled.map((m) => [m.marketId, m]));
  const traded = marketIds ?? (await tradedMarketIds(vault).catch(() => []));
  const candidates = [...new Set([...traded, ...settled.map((m) => m.marketId)])];
  const found = [];

  for (const marketId of candidates) {
    const m = meta.get(marketId) ?? { marketId };
    let record, settlement, balances;
    try {
      record = await readMarketRecord(marketId);
      if (!record.known) continue;
      settlement = await readSettlement(record.yesId);
      if (!settlement.finalized) continue;
      balances = await readOutcomeBalances(vault, { ...record, outcomeToken: settlement.outcomeToken });
    } catch { continue; }

    const held = balances.yes + balances.no;
    if (held === 0n) continue;

    // A void pays both sides; a resolution pays only the winner.
    const claimable = settlement.voided
      ? held
      : settlement.winner === 0 ? balances.yes
      : settlement.winner === 1 ? balances.no
      : 0n;

    found.push({
      marketId,
      asset: m.asset,
      intervalSec: m.intervalSec,
      question: m.question,
      market: record.market,
      outcomeToken: settlement.outcomeToken,
      voided: settlement.voided,
      winner: settlement.winner,
      heldYes: balances.yes,
      heldNo: balances.no,
      claimable,
      worthless: claimable === 0n,
    });
  }
  return found;
}
