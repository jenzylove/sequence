import { useCallback, useEffect, useState } from "react";
import { readVaultState, readStep, readVaultEvents, vaultForAccount } from "../chain/vault.js";

// Local records are scoped to the wallet they belong to. Sharing one key across
// accounts leaked one user's sequence metadata into another's session when the
// same browser switched wallets.
const watchKey = (account) => `sequence.watch.v2:${(account || "none").toLowerCase()}`;

export function loadWatched(account) {
  try { return JSON.parse(localStorage.getItem(watchKey(account)) || "[]"); } catch { return []; }
}
export function recordWatched(account, entry) {
  const next = [entry, ...loadWatched(account).filter((w) => w.stepId !== entry.stepId)].slice(0, 12);
  try { localStorage.setItem(watchKey(account), JSON.stringify(next)); } catch { /* storage unavailable */ }
  return next;
}
export function clearWatched(account) {
  try { localStorage.removeItem(watchKey(account)); } catch { /* storage unavailable */ }
}

// The connected wallet's own trading account, resolved through the factory.
//
// There is no shared vault any more. A wallet that has never provisioned one
// gets `needsVault`, which the interface turns into an invitation rather than a
// dead end reading somebody else's balances.
export function useVault(account, { refreshMs = 12000 } = {}) {
  const [address, setAddress] = useState(null);
  const [resolving, setResolving] = useState(true);
  const [state, setState] = useState(null);
  const [watched, setWatched] = useState([]);
  const [steps, setSteps] = useState([]);
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);

  // Resolve which vault belongs to this wallet before reading anything.
  useEffect(() => {
    let live = true;
    if (!account) {
      setAddress(null); setState(null); setSteps([]); setEvents([]);
      setResolving(false); setStatus("idle");
      return () => { live = false; };
    }
    setResolving(true);
    vaultForAccount(account)
      .then((found) => { if (live) { setAddress(found); setResolving(false); } })
      .catch(() => { if (live) { setAddress(null); setResolving(false); setError("Could not reach the network."); } });
    return () => { live = false; };
  }, [account]);

  const refresh = useCallback(async () => {
    if (!address) { setState(null); setSteps([]); setEvents([]); setStatus("idle"); return; }
    try {
      const vaultState = await readVaultState(address);
      setState(vaultState);
      const list = loadWatched(account);
      setWatched(list);
      const onchain = await Promise.all(list.map(async (w) => ({ ...w, ...(await readStep(w.stepId, address)) })));
      setSteps(onchain);
      const blocks = list.map((w) => (w.blockNumber ? BigInt(w.blockNumber) : null)).filter(Boolean);
      const fromBlock = blocks.length ? blocks.reduce((a, b) => (a < b ? a : b)) : null;
      setEvents(await readVaultEvents({ fromBlock, vault: address }));
      setStatus("ready");
      setError(null);
    } catch (cause) {
      setError(cause?.shortMessage || cause?.message || "Could not read your account.");
      setStatus("error");
    }
  }, [address, account]);

  useEffect(() => {
    let live = true;
    const run = () => { if (live) refresh(); };
    run();
    const timer = window.setInterval(run, refreshMs);
    return () => { live = false; window.clearInterval(timer); };
  }, [refresh, refreshMs]);

  const track = useCallback((entry) => { setWatched(recordWatched(account, entry)); refresh(); }, [account, refresh]);
  const forget = useCallback(() => { clearWatched(account); setWatched([]); setSteps([]); refresh(); }, [account, refresh]);

  // A wallet always owns the vault the factory gave it. The check stays because
  // the answer must come from the chain, not from an assumption.
  const isOwner = useCallback(
    (who) => Boolean(who && state?.owner && who.toLowerCase() === state.owner.toLowerCase()),
    [state],
  );

  const adopt = useCallback((vault) => { setAddress(vault); setStatus("idle"); }, []);

  return {
    address,
    resolving,
    needsVault: Boolean(account) && !resolving && !address,
    state, steps, events, watched, status, error,
    refresh, track, forget, isOwner, adopt,
  };
}
