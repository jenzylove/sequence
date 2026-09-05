import { PHASE } from "../hooks/useTx.js";
import { txUrl } from "../chain/config.js";

// The running commentary for one transaction.
//
// Every phase says what is happening and, when it is the person's turn, says
// that too. Nothing here ever renders an empty or ambiguous state: if the
// wallet has gone quiet, that is stated rather than left to look like progress.
export default function TxState({ tx, labels = {}, className = "" }) {
  const { phase, hash, error, slow } = tx;
  if (phase === PHASE.IDLE) return null;

  const line = {
    [PHASE.CHECKING]: labels.checking || "Checking your balance and preparing the transaction…",
    [PHASE.SIGNING]: labels.signing || "Waiting for you to approve this in your wallet.",
    [PHASE.SUBMITTED]: "Sent to the network.",
    [PHASE.CONFIRMING]: "Approved. Waiting for the network to confirm it…",
    [PHASE.SUCCESS]: labels.success || "Done.",
    [PHASE.FAILED]: error,
  }[phase];

  const tone = phase === PHASE.FAILED ? "text-[#dc6e58]"
    : phase === PHASE.SUCCESS ? "text-[#40906b]"
    : "text-[#7f7984]";

  return (
    <div className={`mt-3 ${className}`} role={phase === PHASE.FAILED ? "alert" : "status"} aria-live="polite">
      <p className={`flex items-start gap-2 text-[10px] font-semibold leading-[1.6] ${tone}`}>
        {tx.busy && <span className="tx-spinner mt-[3px]" aria-hidden="true" />}
        <span>{line}</span>
      </p>

      {/* The wallet has had long enough that silence is worth naming. */}
      {slow && phase === PHASE.SIGNING && (
        <p className="mt-2 text-[10px] leading-[1.6] text-[#a8813f]">
          Your wallet has not answered yet. It may have opened behind this window, or in your browser's extensions menu. Nothing has been sent, and you can safely close this and try again.
        </p>
      )}
      {slow && phase === PHASE.CONFIRMING && (
        <p className="mt-2 text-[10px] leading-[1.6] text-[#a8813f]">
          This is taking longer than usual. It is signed and on the network, so it will land — you do not need to send it again.
        </p>
      )}

      {hash && (
        <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[10px] font-bold text-[#6f58c2]">
          {phase === PHASE.SUCCESS ? "Receipt ↗" : "Follow it on the explorer ↗"}
        </a>
      )}

      {phase === PHASE.FAILED && (
        <button onClick={tx.reset} className="mt-2 block text-[10px] font-bold text-[#6f58c2]">Try again</button>
      )}
    </div>
  );
}
