import { useEffect, useState } from "react";
import TxState from "./TxState.jsx";
import FundPanel from "./FundPanel.jsx";
import { useTx } from "../hooks/useTx.js";
import { createVault, createVaultCall } from "../chain/vault.js";
import { checkGas, FAUCET_URL, TEST_TOKEN_HELP } from "../chain/preflight.js";
import { money } from "../lib/language.js";

// Everything between "I want this sequence" and "it is live".
//
// Account creation and funding used to be an onboarding wall you climbed before
// you were allowed to see the product. They are the same transactions either
// way, but here they arrive attached to a sequence the trader has already built
// and can see, with a limit they chose themselves — so the question is never
// "what is a risk ceiling", it is "this trade risks $5, shall I put $5 in".
//
// Anything the account already satisfies is skipped silently.
export default function ActivateDialog({ open, strategy, wallet, vault, onClose, onArm, arming, progress, armResult }) {
  const [created, setCreated] = useState(null);
  const [gasProblem, setGasProblem] = useState(null);
  const tx = useTx();

  const required = strategy?.maxOutstanding ?? 0n;
  const held = vault.state?.bankroll ?? 0n;
  const needsAccount = vault.needsVault && !created;
  const needsFunds = !needsAccount && held < required;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && !tx.busy && !arming && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, tx.busy, arming, onClose]);

  // Price the account creation before a wallet opens, so an empty wallet is told
  // here rather than by a popup it cannot read.
  useEffect(() => {
    let live = true;
    if (!open || !needsAccount || !wallet.account) return undefined;
    checkGas({ account: wallet.account, contract: createVaultCall({ maxOutstanding: required || 1n }) })
      .then((g) => live && setGasProblem(g.ok === false ? g : null))
      .catch(() => {});
    return () => { live = false; };
  }, [open, needsAccount, wallet.account, required]);

  if (!open) return null;

  const create = async () => {
    const r = await tx.run({
      preflight: () => checkGas({ account: wallet.account, contract: createVaultCall({ maxOutstanding: required }) }),
      send: (onHash) => createVault({
        provider: wallet.provider, account: wallet.account, maxOutstanding: required, onHash,
      }),
    });
    if (r.ok) { setCreated(r.result); vault.adopt(r.result.vault); }
  };

  const stepNumber = needsAccount ? 1 : needsFunds ? 2 : 3;

  return (
    <div className="wallet-modal-backdrop" role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && !tx.busy && !arming && onClose()}>
      <section className="wallet-modal max-h-[88vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="activate-title">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="micro-label">Step {stepNumber} of 3</div>
            <h2 id="activate-title" className="mt-2 text-[22px] font-extrabold tracking-[-.04em] text-[#151318]">
              {needsAccount ? "One thing first" : needsFunds ? "Fund this sequence" : "Put it live"}
            </h2>
          </div>
          <button onClick={onClose} disabled={tx.busy || arming} className="icon-button disabled:opacity-30" aria-label="Close">×</button>
        </div>

        {/* What they are activating, in their own numbers. */}
        <div className="mt-5 rounded-sm border border-[#ece9ef] bg-[#fbfbfc] p-4">
          <div className="text-[9px] uppercase tracking-[0.1em] text-[#a29da6]">Your sequence</div>
          <div className="mt-1 text-[12px] font-bold text-[#28252c]">{strategy?.name || "Sequence"}</div>
          <div className="mt-1.5 text-[10px] leading-[1.6] text-[#817c86]">
            {strategy?.steps?.length || 0} step{(strategy?.steps?.length || 0) === 1 ? "" : "s"} · risks up to {money(required)}
          </div>
        </div>

        {/* ---- 1. the account ------------------------------------------- */}
        {needsAccount && (
          <div className="mt-6">
            <p className="text-[12px] leading-[1.8] text-[#5f5a66]">
              Sequence needs a personal trading account to hold your test funds and enforce the{" "}
              <strong className="font-bold text-[#28252c]">{money(required)}</strong> limit you just chose. It is created
              for your wallet, only your wallet can touch it, and creating it moves no money.
            </p>
            <p className="mt-2.5 text-[10px] leading-[1.7] text-[#8b8590]">
              One transaction on the Somnia test network. You pay a small fee in test STT.
            </p>

            {gasProblem && (
              <div className="mt-4 rounded-sm border border-[#f0dcc6] bg-[#fdf8f1] p-4">
                <div className="text-[11px] font-bold text-[#8a6a34]">Your wallet cannot pay the fee yet</div>
                <p className="mt-1.5 text-[10px] leading-[1.65] text-[#7d6b52]">{gasProblem.message} {TEST_TOKEN_HELP.stt}</p>
                <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="mt-3 inline-block text-[10px] font-bold text-[#6f58c2]">Somnia testnet hub ↗</a>
              </div>
            )}

            <button onClick={create} disabled={tx.busy || Boolean(gasProblem)}
              className="soft-button mt-5 bg-[#111014] px-5 py-2.5 text-white disabled:opacity-35">
              {tx.busy ? "Creating your account…" : "Create account and continue"}
            </button>
            <TxState tx={tx} labels={{
              signing: "Waiting for you to approve this in your wallet. Nothing has been sent yet.",
              success: "Account created.",
            }} />
          </div>
        )}

        {/* ---- 2. the money --------------------------------------------- */}
        {needsFunds && (
          <div className="mt-6">
            <p className="text-[12px] leading-[1.8] text-[#5f5a66]">
              This sequence can put up to <strong className="font-bold text-[#28252c]">{money(required)}</strong> at risk.
              Move at least that much into your account and it is ready to run.
            </p>
            <FundPanel wallet={wallet} vault={vault} required={required} compact />
          </div>
        )}

        {/* ---- 3. the signatures ---------------------------------------- */}
        {!needsAccount && !needsFunds && (
          <div className="mt-6">
            <p className="text-[12px] leading-[1.8] text-[#5f5a66]">
              Your account holds {money(held)} and enforces a {money(required)} limit. Activating gives the markets in this
              sequence permission to draw on it, saves your steps, and arms the first one.
            </p>
            <p className="mt-2.5 text-[10px] leading-[1.7] text-[#8b8590]">
              Several signatures, one after the other. Nothing is at risk until the last one confirms.
            </p>

            <button onClick={onArm} disabled={arming}
              className="soft-button mt-5 w-full bg-[#111014] py-3 text-white disabled:opacity-35">
              {arming ? "Activating…" : `Activate · risk ${money(required)}`}
            </button>

            {arming && progress && (
              <div className="mt-3" role="status" aria-live="polite">
                <p className="flex items-start gap-2 text-[10px] font-semibold leading-[1.6] text-[#7f7984]">
                  <span className="tx-spinner mt-[3px]" aria-hidden="true" />
                  <span>{progress.of > 0 ? `Signature ${progress.at} of ${progress.of}: ` : ""}{progress.label}</span>
                </p>
              </div>
            )}
            {armResult?.ok === false && (
              <p className="mt-3 text-[10px] font-semibold text-[#dc6e58]" role="alert">{armResult.error}</p>
            )}
            {armResult?.ok && (
              <p className="mt-3 text-[10px] font-semibold text-[#40906b]">Live. It is waiting on the market now.</p>
            )}
          </div>
        )}

        <p className="mt-6 border-t border-[#ece9ef] pt-4 text-[9px] leading-[1.6] text-[#aaa5ae]">
          Somnia Shannon test network. Everything here uses test tokens with no real value.
        </p>
      </section>
    </div>
  );
}
