// Fetches the open markets and prints them as JSON. Kept as its own process so
// callers that also load viem are not exposed to the Windows teardown crash
// that combination triggers.
import { fetchOpenMarkets } from "../src/chain/markets.js";
const markets = await fetchOpenMarkets(40);
process.stdout.write(JSON.stringify(markets, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
