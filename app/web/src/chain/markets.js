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
