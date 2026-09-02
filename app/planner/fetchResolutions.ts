// Pull real DreamDEX resolutions from the Somnia markets indexer, so simulate()
// runs against genuine on-chain history rather than synthetic data.
// Field names follow the indexer's current camelCase schema; a schema change
// surfaces as a thrown error here rather than as silently empty results.
import { Resolution } from "./simulate.js";
import { SHANNON } from "./addresses.js";

const MARKET_FIELDS = `
  marketId
  binaryPoolAddress
  question
  asset
  expiry
  finalized
  voided
  winningOutcome
  payoutNumerators
  payoutDenominator
  oracleQuestionId
  resolvedAtTimestamp
`;

async function gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(SHANNON.indexer, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`indexer HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error("indexer: " + JSON.stringify(json.errors));
  return json.data as T;
}

export interface MarketRow {
  marketId: string;
  binaryPoolAddress: string | null;
  question: string | null;
  asset: string | null;
  expiry: string | null;
  finalized: boolean;
  voided: boolean;
  winningOutcome: number | null;
  payoutNumerators: string[] | null;
  payoutDenominator: string | null;
  oracleQuestionId: string | null;
  resolvedAtTimestamp: string | null;
}

// Settled binary markets, newest first.
export async function fetchRecentResolutions(limit = 25): Promise<MarketRow[]> {
  const data = await gql<{ Market: MarketRow[] }>(
    `query Resolved($limit: Int!) {
       Market(
         limit: $limit
         where: { marketType: { _eq: "BINARY" }, finalized: { _eq: true }, marketId: { _is_null: false } }
         order_by: { resolvedAtTimestamp: desc }
       ) { ${MARKET_FIELDS} }
     }`,
    { limit },
  );
  return data.Market ?? [];
}

// Binary markets still trading, soonest settlement first: the candidates a step
// can watch or place into.
export async function fetchOpenMarkets(limit = 40): Promise<MarketRow[]> {
  const now = Math.floor(Date.now() / 1000);
  const data = await gql<{ Market: MarketRow[] }>(
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
  return (data.Market ?? []).filter((m) => m.binaryPoolAddress);
}

// Shape indexer rows into the resolution stream simulate() consumes.
export function toResolutions(rows: MarketRow[]): Resolution[] {
  return rows
    .filter((r) => r.finalized || r.voided)
    .map((r) => ({
      marketId: r.marketId,
      questionId: r.oracleQuestionId ?? "0",
      payoutNumerators: (r.payoutNumerators ?? []).map((n) => BigInt(n)),
      voided: Boolean(r.voided),
    }));
}
