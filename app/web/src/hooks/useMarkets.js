import { useCallback, useEffect, useState } from "react";
import { fetchOpenMarkets, fetchResolvedMarkets, fetchSpotContext } from "../chain/markets.js";

// Live DreamDEX market data. Open markets refresh on an interval because the
// rolling windows settle every minute or two.
export function useMarkets({ refreshMs = 30000 } = {}) {
  const [open, setOpen] = useState([]);
  const [resolved, setResolved] = useState([]);
  const [spot, setSpot] = useState({});
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [nextOpen, nextResolved, nextSpot] = await Promise.all([
        fetchOpenMarkets(40), fetchResolvedMarkets(25), fetchSpotContext(),
      ]);
      setOpen(nextOpen);
      setResolved(nextResolved);
      setSpot(nextSpot);
      setStatus("ready");
      setError(null);
    } catch (cause) {
      setError(cause?.message || "Could not reach the Somnia markets indexer.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let live = true;
    const run = () => { if (live) load(); };
    run();
    const timer = window.setInterval(run, refreshMs);
    return () => { live = false; window.clearInterval(timer); };
  }, [load, refreshMs]);

  return { open, resolved, spot, status, error, reload: load };
}
