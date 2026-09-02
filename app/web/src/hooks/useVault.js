import { useCallback, useEffect, useState } from "react";
import { readVaultState, readStep, readVaultEvents } from "../chain/vault.js";
import { SHANNON } from "../chain/config.js";

const WATCH_KEY = "sequence.watch.v1";

// Steps this browser has actually armed, recorded from real transaction
// receipts so the timeline can be scanned forward from a known block.
export function loadWatched() {
  try { return JSON.parse(localStorage.getItem(WATCH_KEY) || "[]"); } catch { return []; }
}
export function recordWatched(entry) {
  const next = [entry, ...loadWatched().filter((w) => w.stepId !== entry.stepId)].slice(0, 12);
  try { localStorage.setItem(WATCH_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  return next;
}
export function clearWatched() {
  try { localStorage.removeItem(WATCH_KEY); } catch { /* storage unavailable */ }
}

// Live vault state read straight from Shannon. Every field here is a contract
// read; when the read fails the hook reports an error rather than a number.
export function useVault({ refreshMs = 12000 } = {}) {
  const [state, setState] = useState(null);
  const [watched, setWatched] = useState(() => loadWatched());
  const [steps, setSteps] = useState([]);
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const vaultState = await readVaultState();
      setState(vaultState);
      const list = loadWatched();
      setWatched(list);
      const onchain = await Promise.all(list.map(async (w) => ({ ...w, ...(await readStep(w.stepId)) })));
      setSteps(onchain);
      const blocks = list.map((w) => (w.blockNumber ? BigInt(w.blockNumber) : null)).filter(Boolean);
      const fromBlock = blocks.length ? blocks.reduce((a, b) => (a < b ? a : b)) : null;
      setEvents(await readVaultEvents({ fromBlock }));
      setStatus("ready");
      setError(null);
    } catch (cause) {
      setError(cause?.shortMessage || cause?.message || "Could not read the vault on Shannon.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    let live = true;
    const run = () => { if (live) refresh(); };
    run();
    const timer = window.setInterval(run, refreshMs);
    return () => { live = false; window.clearInterval(timer); };
  }, [refresh, refreshMs]);

  const track = useCallback((entry) => { setWatched(recordWatched(entry)); refresh(); }, [refresh]);
  const forget = useCallback(() => { clearWatched(); setWatched([]); setSteps([]); refresh(); }, [refresh]);

  const isOwner = useCallback(
    (account) => Boolean(account && state?.owner && account.toLowerCase() === state.owner.toLowerCase()),
    [state],
  );

  return { address: SHANNON.vault, state, steps, events, watched, status, error, refresh, track, forget, isOwner };
}
