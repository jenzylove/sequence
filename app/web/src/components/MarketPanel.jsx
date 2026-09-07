import { useEffect, useMemo, useState } from "react";
import { fetchCandles, PRICE_SCALE } from "../chain/markets.js";
import { marketName, countdown } from "../lib/language.js";

const pct = (p) => `${((Number(p ?? 0n) / Number(PRICE_SCALE)) * 100).toFixed(1)}%`;
const cents = (p) => `$${(Number(p ?? 0n) / 1e6).toFixed(3)}`;

// What the trader is actually looking at.
//
// The builder used to describe a market in words and ask for a rule about it,
// which is a form to fill in rather than a trading screen. Everything here comes
// from DreamDEX: the market's own traded candles from the indexer, the live book
// the order will cross, and the settlement clock. Nothing is decorative and
// nothing is generated — a market that has not traded says so instead of showing
// an invented line.
export default function MarketPanel({ market, successor, book, spot }) {
  const [candles, setCandles] = useState(null);

  // The chart used to load once and then sit there. On a 1m or 5m market that
  // is most of the market's life spent showing a frozen line, which is the
  // opposite of what a panel watching a live market is for.
  //
  // Poll at a rate the market itself sets: a fast window is worth re-reading
  // every few seconds, a 45-day contract is not. Bounded at both ends so a
  // short market cannot hammer the indexer and a long one still moves.
  const cadence = market?.intervalSec || 0;
  const pollMs = Math.min(120000, Math.max(5000, Math.round((cadence * 1000) / 20) || 15000));

  useEffect(() => {
    let live = true;
    setCandles(null);
    if (!market?.marketId) return undefined;
    const read = () =>
      fetchCandles(market.marketId)
        .then((c) => live && setCandles(c))
        .catch(() => live && setCandles((prev) => prev ?? []));
    read();
    const timer = window.setInterval(read, pollMs);
    return () => { live = false; window.clearInterval(timer); };
  }, [market?.marketId, pollMs]);

  const yes = book?.bestAskYes ?? market?.lastPrice ?? null;
  const no = yes != null ? PRICE_SCALE - yes : null;

  const path = useMemo(() => {
    if (!candles?.length) return null;
    const values = candles.map((c) => Number(c.close));
    const min = Math.min(...values, 0);
    const max = Math.max(...values, Number(PRICE_SCALE));
    const span = max - min || 1;
    const w = 100 / Math.max(1, candles.length - 1);
    return values.map((v, i) => `${i === 0 ? "M" : "L"}${(i * w).toFixed(2)},${(100 - ((v - min) / span) * 100).toFixed(2)}`).join(" ");
  }, [candles]);

  if (!market) return null;
  const traded = candles?.length ? candles.reduce((n, c) => n + c.trades, 0) : 0;

  return (
    <div className="market-panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-[.12em] text-[#a29da6]">Watching</div>
          <div className="mt-1.5 flex items-baseline gap-2.5">
            <span className="text-[22px] font-extrabold tracking-[-.04em] text-[#161419]">{market.asset}</span>
            <span className="text-[12px] font-semibold text-[#6f6879]">{marketName(market)}</span>
          </div>
          {/* Spot is a record, not a number — reading it as one printed "NaN". */}
          {Number.isFinite(spot?.[market.asset]?.price) && (
            <div className="mt-1 text-[11px] text-[#817c86]">
              Spot {spot[market.asset].price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-[9px] font-bold uppercase tracking-[.12em] text-[#a29da6]">Settles</div>
          <div className="mt-1.5 text-[16px] font-extrabold tabular-nums text-[#161419]">
            {market.expiry ? countdown(market.expiry) : "—"}
          </div>
        </div>
      </div>

      {/* Implied probability, straight off the live book. */}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-sm border border-[#d8f0e5] bg-[#f6fcf9] p-3.5">
          <div className="text-[9px] uppercase tracking-[0.1em] text-[#5b9d7e]">Yes</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[18px] font-extrabold text-[#2f7d59]">{yes != null ? pct(yes) : "—"}</span>
            <span className="text-[10px] text-[#7fae97]">{yes != null ? cents(yes) : ""}</span>
          </div>
        </div>
        <div className="rounded-sm border border-[#f3ddd6] bg-[#fdf8f6] p-3.5">
          <div className="text-[9px] uppercase tracking-[0.1em] text-[#b47c69]">No</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[18px] font-extrabold text-[#b3603f]">{no != null ? pct(no) : "—"}</span>
            <span className="text-[10px] text-[#c99783]">{no != null ? cents(no) : ""}</span>
          </div>
        </div>
      </div>

      {/* The market's own traded history. */}
      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <div className="text-[9px] font-bold uppercase tracking-[.12em] text-[#a29da6]">Yes price, traded</div>
          {traded > 0 && <div className="text-[9px] text-[#a8a2ad]">{traded} trade{traded === 1 ? "" : "s"}</div>}
        </div>
        <div className="mt-2 h-[92px] rounded-sm border border-[#ece9ef] bg-[#fcfcfd] p-2">
          {candles === null ? (
            <div className="flex h-full items-center justify-center text-[10px] text-[#a8a2ad]">Reading the market…</div>
          ) : path ? (
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" aria-label="Traded YES price">
              <path d={path} fill="none" stroke="#6f58c2" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            </svg>
          ) : (
            <div className="flex h-full items-center justify-center px-3 text-center text-[10px] leading-[1.5] text-[#a8a2ad]">
              This window has not traded yet, so there is no price history to show.
            </div>
          )}
        </div>
      </div>

      {/* What the order would actually meet. */}
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-[#ece9ef] pt-4">
        <Fact label="Best ask" value={book?.bestAskYes ? cents(book.bestAskYes) : "—"} />
        <Fact label="Depth" value={book?.depth != null ? String(book.depth) : "—"} />
        <Fact label="Then trades" value={successor ? marketName(successor) : "—"} />
      </div>
    </div>
  );
}

function Fact({ label, value }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.1em] text-[#a29da6]">{label}</div>
      <div className="mt-1 truncate text-[11px] font-semibold text-[#28252c]">{value}</div>
    </div>
  );
}
