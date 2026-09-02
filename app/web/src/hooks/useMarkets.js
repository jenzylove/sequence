import { useCallback, useEffect, useState } from "react";
import { fetchOpenMarkets, fetchResolvedMarkets } from "../chain/markets.js";

// Live DreamDEX market data. Open markets refresh on an interval because the
// rolling windows settle every minute or two.
export function useMarkets({ refreshMs = 45000 } = {}) {
  const [open, setOpen] = useState([]);
  const [resolved, setResolved] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [nextOpen, nextResolved] = await Promise.all([fetchOpenMarkets(40), fetchResolvedMarkets(25)]);
      setOpen(nextOpen);
      setResolved(nextResolved);
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

  return { open, resolved, status, error, reload: load };
}
