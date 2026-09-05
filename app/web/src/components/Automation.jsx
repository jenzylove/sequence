import { useState } from "react";
import TxState from "./TxState.jsx";
import { useTx } from "../hooks/useTx.js";
import { fundVault, subscribeAllMarkets } from "../chain/vault.js";
import { checkGasForTransfer, som, FAUCET_URL } from "../chain/preflight.js";

const STAKE = 32n * 10n ** 18n;
const stt = (raw) => `${(Number(raw ?? 0n) / 1e18).toFixed(2)} STT`;

// Hands-free delivery: a setting, not a setup step.
//
// This used to sit on the dashboard as one of three equal cards headed "Set your
// account up", next to the funding a sequence genuinely cannot run without. That
// framing sent every new trader at a 32 STT stake most of them cannot reach, to
// buy something they did not yet need.
//
// It is an upgrade to how a settled result reaches the account, and the honest
// version of the trade-off is stated here rather than implied: with it, Somnia
// pushes results in automatically; without it, a settled market still advances
// the sequence, but somebody has to press "Check result" — which anyone can do,
// and which is not the same thing as hands-free.
export default function Automation({ vault, wallet }) {
  const [open, setOpen] = useState(false);
  const tx = useTx();

  const state = vault.state;
  if (!state || !vault.isOwner(wallet.account)) return null;

  const funded = state.native >= STAKE;
  const shortfall = funded ? 0n : STAKE - state.native;
  const on = Boolean(state.subscribed);

  const run = async (send, preflight) => {
    const r = await tx.run({ preflight, send });
    if (r.ok) await vault.refresh();
  };

  return (
    <div className="workspace-card mt-8">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-7 py-5 text-left"
      >
        <div>
          <div className="text-[12px] font-bold text-[#28252c]">Automation</div>
          <p className="mt-1 text-[10px] leading-[1.6] text-[#8b8590]">
            {on
              ? "On. Settled markets reach your account automatically."
              : "Off. Your sequences still run — a settled market is advanced by pressing Check result, which anyone can do."}
          </p>
        </div>
        <span className="flex items-center gap-3">
          <span className={`rounded-full px-2.5 py-1 text-[8px] font-bold uppercase tracking-[.1em] ${on ? "bg-[#eaf7f0] text-[#40906b]" : "bg-[#f2f0f7] text-[#8b8590]"}`}>
            {on ? "On" : "Off"}
          </span>
          <span className="text-[#aaa4ae]">{open ? "▲" : "▼"}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-[#ece9ef] px-7 py-6">
          <p className="max-w-[620px] text-[11px] leading-[1.75] text-[#5f5a66]">
            Somnia can push a market's result straight into your account the moment it settles, so a sequence continues
            with nobody watching. The network asks any account that wants this to hold a{" "}
            <strong className="font-bold text-[#28252c]">{stt(STAKE)}</strong> stake. The stake stays yours and is released
            if you turn this off.
          </p>
          <p className="mt-3 max-w-[620px] text-[11px] leading-[1.75] text-[#8b8590]">
            Without it nothing breaks. When a market settles, your sequence advances as soon as anyone presses{" "}
            <strong className="font-bold text-[#5f5a66]">Check result</strong> on it — you, or anyone else. It is a real
            path, not a fallback we are embarrassed about, but it is not automatic and we will not call it hands-free.
          </p>

          {on ? (
            <p className="mt-5 text-[11px] font-semibold text-[#40906b]">
              Subscription {String(state.subscriptionId)} is live. Your account holds {stt(state.native)}.
            </p>
          ) : (
            <div className="mt-5">
              <div className="text-[10px] text-[#8b8590]">
                Account holds {stt(state.native)}
                {!funded && ` · needs ${stt(shortfall)} more`}
              </div>
              <button
                onClick={() => (funded
                  ? run((onHash) => subscribeAllMarkets({ provider: wallet.provider, account: wallet.account, vault: vault.address, onHash }))
                  : run(
                      (onHash) => fundVault({ provider: wallet.provider, account: wallet.account, vault: vault.address, value: shortfall, onHash }),
                      () => checkGasForTransfer({ account: wallet.account, to: vault.address, value: shortfall }),
                    ))}
                disabled={tx.busy}
                className="soft-button mt-3 bg-[#111014] px-5 py-2.5 text-white disabled:opacity-35"
              >
                {tx.busy ? "Working…" : funded ? "Turn automation on" : `Stake ${stt(shortfall)}`}
              </button>
              <TxState tx={tx} />
              {!funded && (
                <p className="mt-3 text-[10px] leading-[1.6] text-[#a19ca5]">
                  Most test wallets hold nowhere near this much. If yours does not, leave automation off — it changes
                  nothing about whether your sequence is correct.{" "}
                  <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="font-bold text-[#6f58c2]">Somnia testnet hub ↗</a>
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
