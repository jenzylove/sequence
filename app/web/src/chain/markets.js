// Real DreamDEX market data from the Somnia markets indexer.
// No market shown in Sequence is invented: marketId, pool address, question
// text, expiry and payout vectors all come from this endpoint.
import { SHANNON } from "./config.js";

async function gql(query, variables = {}) {
  const res = await fetch(SHANNON.indexer, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`indexer HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data;
}

const MARKET_FIELDS = `
  marketId
  binaryPoolAddress
  poolAddress
  question
  asset
  strike
  expiry
  tradingStart
  clobStatus
  finalized
  voided
  winningOutcome
  payoutNumerators
  payoutDenominator
  oracleQuestionId
  resolvedAtTimestamp
  lastPrice
  tradeCount
  cumulativeQuoteVolume
  intervalSec
`;

function shape(row) {
  return {
    marketId: row.marketId,
    pool: row.binaryPoolAddress || row.poolAddress,
    question: row.question,
    asset: row.asset,
    strike: row.strike,
    expiry: row.expiry ? Number(row.expiry) : null,
    tradingStart: row.tradingStart ? Number(row.tradingStart) : null,
    clobStatus: row.clobStatus,
    finalized: Boolean(row.finalized),
    voided: Boolean(row.voided),
    winningOutcome: row.winningOutcome === null || row.winningOutcome === undefined ? null : Number(row.winningOutcome),
    payoutNumerators: (row.payoutNumerators || []).map((n) => BigInt(n)),
    payoutDenominator: row.payoutDenominator ? BigInt(row.payoutDenominator) : null,
    questionId: row.oracleQuestionId ? BigInt(row.oracleQuestionId) : null,
    resolvedAt: row.resolvedAtTimestamp ? Number(row.resolvedAtTimestamp) : null,
    lastPrice: row.lastPrice ? BigInt(row.lastPrice) : null,
    tradeCount: row.tradeCount ? Number(row.tradeCount) : 0,
    volume: row.cumulativeQuoteVolume ? BigInt(row.cumulativeQuoteVolume) : 0n,
    intervalSec: row.intervalSec ? Number(row.intervalSec) : null,
  };
}

// Binary markets still trading: these are the ones a step can watch or place into.
export async function fetchOpenMarkets(limit = 40) {
  const now = Math.floor(Date.now() / 1000);
  const data = await gql(
    `query Open($limit: Int!, $now: numeric!) {
       Market(
         limit: $limit
         where: {
           marketType: { _eq: "BINARY" }
           finalized: { _eq: false }
           marketId: { _is_null: false }
           clobStatus: { _eq: "Trading" }
           expiry: { _gt: $now }
         }
         order_by: { expiry: asc }
       ) { ${MARKET_FIELDS} }
     }`,
    { limit, now },
  );
  return (data.Market || []).map(shape).filter((m) => m.pool && m.marketId);
}

// Genuine settled markets, newest first. Used to replay simulation against real
// resolution history rather than synthetic data.
export async function fetchResolvedMarkets(limit = 25) {
  const data = await gql(
    `query Resolved($limit: Int!) {
       Market(
         limit: $limit
         where: { marketType: { _eq: "BINARY" }, finalized: { _eq: true }, marketId: { _is_null: false } }
         order_by: { resolvedAtTimestamp: desc }
       ) { ${MARKET_FIELDS} }
     }`,
    { limit },
  );
  return (data.Market || []).map(shape).filter((m) => m.marketId);
}

export async function fetchMarketById(marketId) {
  const data = await gql(
    `query One($id: String!) { Market(limit: 1, where: { marketId: { _eq: $id } }) { ${MARKET_FIELDS} } }`,
    { id: marketId },
  );
  const row = (data.Market || [])[0];
  return row ? shape(row) : null;
}

// Human label for a market, derived from real indexer fields only.
export function marketLabel(m) {
  if (!m) return "Unknown market";
  const when = m.expiry ? new Date(m.expiry * 1000).toUTCString().slice(5, 22) : "no expiry";
  return `${m.asset || "Market"} · ${when} UTC`;
}

// Live spot reference prices for the assets these markets settle against.
// These are real SPOT market prints from the same indexer, used only as
// context; Sequence never forecasts them.
export async function fetchSpotContext() {
  const data = await gql(
    `query Spot {
       Market(limit: 12, where: { marketType: { _eq: "SPOT" } }) {
         baseSymbol quoteSymbol baseDecimals quoteDecimals lastPrice markPrice lastTradeAt
       }
     }`,
  );
  const wanted = { WBTC: "BTC", WETH: "ETH", SOMI: "SOMI" };
  const out = {};
  for (const row of data.Market || []) {
    const asset = wanted[row.baseSymbol];
    if (!asset || !row.lastPrice) continue;
    const decimals = row.quoteDecimals ? Number(row.quoteDecimals) : 18;
    out[asset] = {
      asset,
      symbol: row.baseSymbol,
      price: Number(row.lastPrice) / 10 ** decimals,
      mark: row.markPrice ? Number(row.markPrice) / 10 ** decimals : null,
      at: row.lastTradeAt ? Number(row.lastTradeAt) : null,
    };
  }
  return out;
}

// The live book for one market.
//
// The venue quotes a binary market in YES terms only: every resting order is
// BUY_YES or SELL_YES. NO is the complement, so buying NO at price p requires
// someone willing to buy YES at (1 - p). That makes the best NO ask the
// complement of the best YES bid, which is how it is derived here rather than
// guessed.
export async function fetchBook(marketId) {
  const data = await gql(
    `query Book($id: String!) {
       Order(
         limit: 200
         where: { market_id: { _eq: $id }, status: { _eq: "Open" }, side: { _is_null: false } }
       ) { side price quantityRemaining }
     }`,
    { id: marketId },
  );
  const rows = data.Order || [];
  let bestBidYes = null;   // highest price someone will pay for YES
  let bestAskYes = null;   // lowest price someone will sell YES at
  for (const r of rows) {
    const price = BigInt(r.price);
    if (r.side === "BUY_YES") { if (bestBidYes === null || price > bestBidYes) bestBidYes = price; }
    else if (r.side === "SELL_YES") { if (bestAskYes === null || price < bestAskYes) bestAskYes = price; }
  }
  const ONE = 1000000n; // a binary contract settles at 1.00 collateral
  return {
    bestBidYes,
    bestAskYes,
    bestAskNo: bestBidYes === null ? null : ONE - bestBidYes,
    bestBidNo: bestAskYes === null ? null : ONE - bestAskYes,
    depth: rows.length,
  };
}

// What to pay to actually cross the book for a given side, with headroom for the
// market moving between now and settlement. Returns null when there is nothing
// resting to cross, because inventing a price there would be a guess.
export function crossingPrice(book, buyNo, bufferBps = 1500n) {
  const ask = buyNo ? book.bestAskNo : book.bestAskYes;
  if (ask === null || ask <= 0n) return null;
  const ONE = 1000000n;
  const withBuffer = ask + (ask * bufferBps) / 10000n;
  // A binary contract can never be worth more than 1.00, and a price of 0 is
  // not an order.
  if (withBuffer >= ONE) return ONE - 1000n;
  return withBuffer < 1000n ? 1000n : withBuffer;
}

// The pool's own trading rules. A price must sit on a tick, a quantity must be
// at least the minimum and aligned to a lot, and a pool REVERTS rather than
// returning false when they are not: an order of 2 against a minimum of 1000
// reverts QuantityBelowMinimum. Sizing has to respect these or nothing trades.
export const poolParamsAbi = [{
  type: "function", stateMutability: "view", name: "getOrderBookParameters",
  inputs: [],
  outputs: [{ type: "tuple", components: [
    { type: "uint256", name: "tickSize" },
    { type: "uint256", name: "minQuantity" },
    { type: "uint256", name: "lotSize" },
  ] }],
}];

// Prices are a fraction of one collateral unit in 6dp and quantities are base
// units in 6dp, so an order costs price*quantity/1e6.
export const PRICE_SCALE = 1000000n;
export const orderCost = (price, quantity) => (price * quantity) / PRICE_SCALE;

// Largest order that respects the pool's rules and still costs no more than the
// budget. Returns null when even one lot is too expensive, because sizing down
// past the minimum is not an order the pool will take.
export function sizeOrder({ price, budget, tickSize, minQuantity, lotSize }) {
  const tick = tickSize > 0n ? tickSize : 1n;
  const lot = lotSize > 0n ? lotSize : 1n;
  const min = minQuantity > 0n ? minQuantity : lot;

  // Round the price UP to a tick: for a buy that keeps it crossing.
  const onTick = ((price + tick - 1n) / tick) * tick;
  if (onTick <= 0n) return null;

  const affordable = (budget * PRICE_SCALE) / onTick;
  let quantity = (affordable / lot) * lot;
  if (quantity < min) {
    // One minimum-sized order is the smallest thing that can trade at all.
    const smallest = ((min + lot - 1n) / lot) * lot;
    if (orderCost(onTick, smallest) > budget) return null;
    quantity = smallest;
  }
  return { price: onTick, quantity, cost: orderCost(onTick, quantity) };
}

export async function fetchPoolParams(pool, client) {
  const [params] = await Promise.all([
    client.readContract({ address: pool, abi: poolParamsAbi, functionName: "getOrderBookParameters" }),
  ]);
  return { tickSize: params.tickSize, minQuantity: params.minQuantity, lotSize: params.lotSize };
}

// Used before a pool has answered. Chosen to match what Shannon's binary pools
// actually report, so a budget typed before the read lands still produces a
// sane order rather than a quantity of 4.
export const DEFAULT_POOL_PARAMS = { tickSize: 1000n, minQuantity: 1000n, lotSize: 1000n };
