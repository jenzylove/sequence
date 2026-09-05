import { useCallback, useEffect, useRef, useState } from "react";

// One transaction, told honestly.
//
// The product used to hold a single `busy` boolean, which rendered as "Approve
// in your wallet…" from the first click until the receipt arrived — and forever
// if the wallet never answered. That one label was covering six genuinely
// different situations, and three of them need the user to do something.
//
// These are those six. Each one says what is happening and, where it applies,
// whose turn it is.
export const PHASE = {
  IDLE: "idle",
  CHECKING: "checking",     // reading balances and preparing the call
  SIGNING: "signing",       // the wallet is open, waiting on the person
  SUBMITTED: "submitted",   // signed and broadcast, we have a hash
  CONFIRMING: "confirming", // on chain, waiting to be mined
  SUCCESS: "success",
  FAILED: "failed",
};

// How long the wallet may stay silent before we stop implying it is normal.
// A wallet that never opened, or opened behind the window, looks exactly like a
// slow one until somebody says so.
const SLOW_SIGNATURE_MS = 20000;
const SLOW_CONFIRM_MS = 45000;

export function useTx() {
  const [phase, setPhase] = useState(PHASE.IDLE);
  const [hash, setHash] = useState(null);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [slow, setSlow] = useState(false);
  const timer = useRef(null);
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; window.clearTimeout(timer.current); }, []);

  const reset = useCallback(() => {
    window.clearTimeout(timer.current);
    setPhase(PHASE.IDLE); setHash(null); setError(null); setDetail(null); setSlow(false);
  }, []);

  const arm = useCallback((ms) => {
    window.clearTimeout(timer.current);
    setSlow(false);
    timer.current = window.setTimeout(() => alive.current && setSlow(true), ms);
  }, []);

  // `preflight` may return { ok:false, message } to stop before the wallet opens.
  // `send` receives an onHash callback so the submitted phase is real rather
  // than assumed.
  const run = useCallback(async ({ preflight, send }) => {
    window.clearTimeout(timer.current);
    setError(null); setDetail(null); setSlow(false); setHash(null);
    setPhase(PHASE.CHECKING);
    try {
      if (preflight) {
        const check = await preflight();
        if (check && check.ok === false) {
          setPhase(PHASE.FAILED);
          setError(check.message || "This cannot be done right now.");
          setDetail(check);
          return { ok: false, check };
        }
      }

      setPhase(PHASE.SIGNING);
      arm(SLOW_SIGNATURE_MS);

      const result = await send((submittedHash) => {
        if (!alive.current) return;
        setHash(submittedHash);
        setPhase(PHASE.CONFIRMING);
        arm(SLOW_CONFIRM_MS);
      });

      window.clearTimeout(timer.current);
      if (!alive.current) return { ok: true, result };
      setSlow(false);
      setPhase(PHASE.SUCCESS);
      return { ok: true, result };
    } catch (cause) {
      window.clearTimeout(timer.current);
      if (!alive.current) return { ok: false };
      setSlow(false);
      setPhase(PHASE.FAILED);
      setError(readableError(cause));
      return { ok: false, cause };
    }
  }, [arm]);

  return {
    phase, hash, error, detail, slow, run, reset,
    busy: [PHASE.CHECKING, PHASE.SIGNING, PHASE.SUBMITTED, PHASE.CONFIRMING].includes(phase),
    done: phase === PHASE.SUCCESS,
  };
}

// Wallet errors are written for developers. These are the ones a person will
// actually hit, said the way they would say them.
export function readableError(cause) {
  const code = cause?.code ?? cause?.cause?.code;
  const raw = `${cause?.shortMessage || ""} ${cause?.message || ""}`.toLowerCase();

  if (code === 4001 || raw.includes("user rejected") || raw.includes("user denied")) {
    return "You cancelled this in your wallet. Nothing was sent.";
  }
  if (raw.includes("insufficient funds")) {
    return "Your wallet does not hold enough STT to cover the network fee. Nothing was sent.";
  }
  if (code === 4902 || raw.includes("unrecognized chain")) {
    return "Your wallet does not have Somnia Shannon yet. Add the network, then try again.";
  }
  if (raw.includes("chain") && raw.includes("mismatch")) {
    return "Your wallet is on a different network. Switch it to Somnia Shannon and try again.";
  }
  if (raw.includes("nonce")) {
    return "Your wallet is out of step with the network. Reset the account in your wallet's settings, then try again.";
  }
  if (raw.includes("timeout") || raw.includes("timed out")) {
    return "The network did not answer in time. Your transaction may still go through — check the receipt before retrying.";
  }
  if (raw.includes("reverted")) {
    return "The network refused this transaction, so nothing changed. This usually means a condition stopped being true while you were signing.";
  }
  return cause?.shortMessage || cause?.message || "That did not go through. Nothing was changed.";
}
