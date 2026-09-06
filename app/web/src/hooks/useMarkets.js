import { useCallback, useEffect, useRef, useState } from "react";
import { looksInternal } from "./useTx.js";
import { fetchOpenMarkets, fetchResolvedMarkets, fetchSpotContext } from "../chain/markets.js";

// Live DreamDEX market data. Open markets refresh on an interval because the
// rolling windows settle every minute or two.
export function useMarkets({ refreshMs = 30000 } = {}) {
  const [open, setOpen] = useState([]);
  const [resolved, setResolved] = useState([]);
  const [spot, setSpot] = useState({});
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const statusRef = useRef("loading");

  // The indexer answers three separate questions, and they fail independently.
  // Promise.all threw all three away when any one of them 504'd, which is how a
  // transient outage on the *resolved* feed could empty the open-markets list
  // the builder is made of. Settle them separately and keep whatever arrived.
  const load = useCallback(async () => {
    const [o, r, sp] = await Promise.allSettled([
      fetchOpenMarkets(40), fetchResolvedMarkets(60), fetchSpotContext(),
    ]);
    if (o.status === "fulfilled") setOpen(o.value);
    if (r.status === "fulfilled") setResolved(r.value);
    if (sp.status === "fulfilled") setSpot(sp.value);

    // Open markets are the ones the product cannot work without.
    if (o.status === "fulfilled") {
      setStatus("ready");
      setError(null);
      return;
    }
    const why = o.reason;
    setError(looksInternal(why?.message || "")
      ? "Could not reach the Somnia markets indexer."
      : (why?.message || "Could not reach the Somnia markets indexer."));
    setStatus("error");
  }, []);

  useEffect(() => {
    let live = true;
    const run = () => { if (live) load(); };
    run();
    const timer = window.setInterval(run, refreshMs);
    const retry = window.setInterval(() => { if (live && statusRef.current === "error") load(); }, 6000);
    return () => { live = false; window.clearInterval(timer); window.clearInterval(retry); };
  }, [load, refreshMs]);

  useEffect(() => { statusRef.current = status; }, [status]);

  return { open, resolved, spot, status, error, reload: load };
}
