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
