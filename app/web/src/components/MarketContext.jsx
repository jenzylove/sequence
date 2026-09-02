import { useEffect, useState } from "react";
import { settlePhrase, marketName, asOdds } from "../lib/language.js";

// Live market context, kept deliberately thin: the price the market is trading
// at, when the next window settles, and what the book currently implies. All of
// it is real indexer data. Sequence never predicts any of these numbers.
export default function MarketContext({ markets }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const spot = markets.spot || {};
  const next = {};
  for (const m of markets.open) {
    if (!m.asset) continue;
    if (!next[m.asset] || (m.expiry || 0) < (next[m.asset].expiry || 0)) next[m.asset] = m;
  }
  const assets = ["BTC", "ETH"].filter((a) => spot[a] || next[a]);

  if (assets.length === 0) {
    return (
      <div className="market-strip">
        <span className="text-[11px] text-[#8d8792]">
          {markets.status === "error" ? "Market data is unavailable right now." : "Loading live markets…"}
        </span>
      </div>
    );
  }

  return (
    <div className="market-strip">
      {assets.map((asset) => {
        const price = spot[asset];
        const market = next[asset];
        const odds = market ? asOdds(market.lastPrice) : null;
        const drift = price?.mark ? price.price - price.mark : null;
        return (
          <div key={asset} className="market-tile">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] font-bold tracking-[-.02em] text-[#242128]">{asset}</span>
              {price && (
                <span className={`text-[10px] font-semibold ${drift === null ? "text-[#8d8792]" : drift >= 0 ? "text-[#40906b]" : "text-[#d1795f]"}`}>
                  {price.price.toLocaleString(undefined, { maximumFractionDigits: price.price > 100 ? 0 : 2 })}
                </span>
              )}
            </div>
            {market ? (
              <>
                <div className="mt-2 text-[10px] leading-[1.5] text-[#7f7984]">{marketName(market)}</div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[9px] font-semibold uppercase tracking-[.1em] text-[#a19ca5]">{settlePhrase(market.expiry)}</span>
                  {odds !== null
                    ? <span className="odds-pill">{odds}% yes</span>
                    : <span className="text-[9px] text-[#b3aebb]">no trades yet</span>}
                </div>
                {odds !== null && (
                  <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-[#ebe8ee]">
                    <div className="h-full rounded-full bg-[#8b72e8] transition-all" style={{ width: `${Math.min(100, Math.max(2, odds))}%` }} />
                  </div>
                )}
              </>
            ) : (
              <div className="mt-2 text-[10px] text-[#a19ca5]">No window open right now.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
