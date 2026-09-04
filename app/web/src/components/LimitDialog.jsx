import { useEffect, useState } from "react";
import { money } from "../lib/language.js";
import { sendVaultTx } from "../chain/vault.js";

// The hard ceiling on everything Sequence can do. It lives on the account
// itself, not in the interface, so raising it is a transaction the owner signs.
export default function LimitDialog({ vault, wallet, onClose }) {
  const [value, setValue] = useState(() => (vault.state ? String(Number(vault.state.maxOutstanding) / 1e6) : "5"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const state = vault.state;
  if (!state) return null;

  const next = BigInt(Math.max(0, Math.round(Number(value || 0) * 1e6)));
  const funds = state.bankroll ?? 0n;
  const overFunds = next > funds && funds > 0n;
  const isOwner = vault.isOwner(wallet.account);
  const ready = isOwner && wallet.onShannon && next > 0n && next !== state.maxOutstanding && !busy;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendVaultTx({
        provider: wallet.provider, account: wallet.account, vault: vault.address,
        functionName: "setMaxOutstanding", args: [next],
      });
      await vault.refresh();
      onClose();
    } catch (cause) {
      setError(cause?.shortMessage || cause?.message || "That did not go through. Your limit is unchanged.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wallet-modal-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <section className="wallet-modal" role="dialog" aria-modal="true" aria-labelledby="limit-title">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="micro-label">Risk limit</div>
            <h2 id="limit-title" className="mt-2 text-[24px] font-extrabold tracking-[-.04em] text-[#151318]">The most you can have at risk</h2>
          </div>
          <button onClick={onClose} disabled={busy} className="icon-button" aria-label="Close">×</button>
        </div>

        <p className="mt-4 text-[11px] leading-[1.75] text-[#7f7984]">
          No sequence can push you past this, however many you run. Your account checks it before every trade and stands down anything that would cross it.
        </p>

        <label className="mt-6 block">
          <span className="mb-2 block text-[9px] font-bold uppercase tracking-[.12em] text-[#9d98a2]">New limit</span>
          <div className="input-prefix">
            <span>$</span>
            <input type="number" step="1" min="0" value={value} onChange={(e) => setValue(e.target.value)} aria-label="New risk limit in dollars" />
          </div>
        </label>

        <div className="mt-5 flex items-center justify-between text-[10px]">
          <span className="text-[#8d8792]">Now</span>
          <span className="font-semibold text-[#312d35]">{money(state.maxOutstanding)}</span>
        </div>
        <div className="mt-2.5 flex items-center justify-between text-[10px]">
          <span className="text-[#8d8792]">Funds in your account</span>
          <span className="font-semibold text-[#312d35]">{money(funds)}</span>
        </div>

        {overFunds && (
          <p className="mt-4 text-[10px] font-semibold text-[#a8834f]">
            That is above the {money(funds)} you hold, so trades could still fail for lack of funds even though the limit allows them.
          </p>
        )}
        {!isOwner && <p className="mt-4 text-[10px] font-semibold text-[#a8a2ad]">This wallet does not control the account.</p>}
        {error && <p className="mt-4 text-[10px] font-semibold text-[#dc6e58]" role="alert">{error}</p>}

        <div className="mt-6 flex items-center gap-3">
          <button disabled={!ready} onClick={save} className="soft-button bg-[#111014] px-6 py-3 text-white disabled:opacity-35">
            {busy ? "Approve in your wallet…" : "Save limit"}
          </button>
          <button onClick={onClose} disabled={busy} className="text-[10px] font-semibold text-[#8f8994] hover:text-[#242128]">Cancel</button>
        </div>
      </section>
    </div>
  );
}
