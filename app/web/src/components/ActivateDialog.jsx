import { useEffect, useState } from "react";
import { describeStep, money } from "../lib/language.js";
import { validate, toVaultStep, onchainStepId, notionalOf } from "../strategy.js";
import { armStep } from "../chain/vault.js";
import { txUrl } from "../chain/config.js";

// The last thing a user sees before money is at risk. It states, in their own
// language, exactly what will happen and the most they can lose, then takes one
// wallet approval per step. Each step watches its own market, so once approved
// they run on their own.
export default function ActivateDialog({ strategy, markets, vault, wallet, onClose, onDone }) {
  const [progress, setProgress] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  if (!strategy) return null;

  const errors = validate(strategy);
  const planned = strategy.steps.reduce((sum, s) => sum + notionalOf(s), 0n);
  const isOwner = vault.isOwner(wallet.account);
  const ready = wallet.connected && wallet.onShannon && isOwner && !vault.state?.paused && errors.length === 0;

  const blocker = !wallet.connected
    ? "Connect your wallet to put this live."
    : !wallet.onShannon
      ? "Switch your wallet to the Somnia network."
      : !isOwner
        ? "This wallet does not control the trading account."
        : vault.state?.paused
          ? "Trading is paused. Resume it before putting a sequence live."
          : errors.length
            ? errors[0].message
            : null;

  const activate = async () => {
    setBusy(true);
    setError(null);
    const done = [];
    try {
      for (const step of strategy.steps) {
        setProgress([...done, { key: step.key, state: "signing" }]);
        const stepId = onchainStepId(strategy, step);
        const result = await armStep({
          provider: wallet.provider, account: wallet.account, stepId, step: toVaultStep(step),
        });
        const trigger = markets.open.find((m) => m.marketId === step.triggerMarketId);
        const successor = markets.open.find((m) => m.marketId === step.successorMarketId);
        vault.track({
          stepId, key: step.key, name: step.name, strategy: strategy.name,
          triggerLabel: trigger?.question || step.triggerLabel,
          successorLabel: successor?.question || step.successorLabel,
          triggerMarketId: step.triggerMarketId, triggerExpiry: step.triggerExpiry,
          pool: step.pool, blockNumber: result.blockNumber.toString(),
          txHash: result.hash, armedAt: Date.now(),
        });
        done.push({ key: step.key, state: "live", hash: result.hash });
        setProgress([...done]);
      }
      onDone?.(strategy);
    } catch (cause) {
      setError(cause?.shortMessage || cause?.message || "That did not go through. Nothing was risked.");
      setProgress(done);
    } finally {
      setBusy(false);
    }
  };

  const allLive = progress.length === strategy.steps.length && progress.every((p) => p.state === "live");

  return (
    <div className="wallet-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <section className="wallet-modal" role="dialog" aria-modal="true" aria-labelledby="activate-title">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="micro-label">Before it goes live</div>
            <h2 id="activate-title" className="mt-2 text-[24px] font-extrabold tracking-[-.04em] text-[#151318]">
              {allLive ? "Your sequence is live" : "Check this over"}
            </h2>
          </div>
          <button onClick={onClose} disabled={busy} className="icon-button" aria-label="Close">×</button>
        </div>

        {!allLive && (
          <>
            <ol className="mt-6 space-y-3">
              {strategy.steps.map((step, i) => {
                const trigger = markets.open.find((m) => m.marketId === step.triggerMarketId);
                const successor = markets.open.find((m) => m.marketId === step.successorMarketId);
                const p = progress.find((x) => x.key === step.key);
                return (
                  <li key={step.key} className="flex gap-3">
                    <span className={`mt-0.5 grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full border bg-white text-[9px] font-bold ${p?.state === "live" ? "border-[#55b58a] text-[#42946f]" : "border-[#8b72e8] text-[#7056c9]"}`}>
                      {p?.state === "live" ? "✓" : i + 1}
                    </span>
                    <p className="text-[11px] leading-[1.7] text-[#5d5862]">
                      {describeStep(step, { triggerMarket: trigger, successorMarket: successor })}
                      {p?.state === "signing" && <span className="ml-1 font-semibold text-[#7056c9]">Approve this in your wallet…</span>}
                    </p>
                  </li>
                );
              })}
            </ol>

            <div className="mt-6 rounded-sm bg-[#f8f7fc] p-5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#7f7984]">The most you can lose</span>
                <span className="text-[16px] font-extrabold tracking-[-.03em] text-[#161419]">{money(strategy.maxOutstanding)}</span>
              </div>
              <p className="mt-3 text-[10px] leading-[1.65] text-[#85808a]">
                Your trading account enforces this itself. Even if every step fires, it will stand down anything that would push you past {money(strategy.maxOutstanding)}. If every step fits, it commits {money(planned)}.
              </p>
            </div>

            <p className="mt-5 text-[10px] leading-[1.65] text-[#85808a]">
              You approve {strategy.steps.length === 1 ? "one transaction" : `${strategy.steps.length} transactions, one per step`}. After that each step waits on its own market and runs without you.
            </p>

            {blocker && <p className="mt-4 text-[10px] font-semibold text-[#a8a2ad]">{blocker}</p>}
            {error && <p className="mt-4 text-[10px] font-semibold text-[#dc6e58]" role="alert">{error}</p>}

            <div className="mt-6 flex items-center gap-3">
              <button disabled={!ready || busy} onClick={activate} className="soft-button bg-[#111014] px-6 py-3 text-white disabled:opacity-35">
                {busy ? "Approve in your wallet…" : `Put it live · risk ${money(strategy.maxOutstanding)}`}
              </button>
              <button onClick={onClose} disabled={busy} className="text-[10px] font-semibold text-[#8f8994] hover:text-[#242128]">Not yet</button>
            </div>
          </>
        )}

        {allLive && (
          <>
            <p className="mt-5 text-[11px] leading-[1.75] text-[#5d5862]">
              Each step is now waiting on its market. When one settles, Sequence reads the result and places your follow-on trade, or stands down if your rules say not to. You do not need to stay here.
            </p>
            <ul className="mt-5 space-y-2">
              {progress.map((p, i) => (
                <li key={p.key} className="flex items-center justify-between text-[10px]">
                  <span className="text-[#7f7984]">Step {i + 1} live</span>
                  <a href={txUrl(p.hash)} target="_blank" rel="noreferrer" className="font-semibold text-[#6f58c2]">Receipt ↗</a>
                </li>
              ))}
            </ul>
            <button onClick={onClose} className="soft-button mt-6 bg-[#111014] px-6 py-3 text-white">Done</button>
          </>
        )}
      </section>
    </div>
  );
}
