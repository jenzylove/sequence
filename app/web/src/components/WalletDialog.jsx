import { useEffect } from "react";
import { shortAccount } from "../hooks/useWallet.js";

export default function WalletDialog({ open, wallet, reason = null, onConnected, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="wallet-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-title">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="micro-label">Wallet</div>
            <h2 id="wallet-title" className="mt-2 text-[24px] font-extrabold tracking-[-.04em] text-[#151318]">Choose a wallet</h2>
            <p className="mt-2 text-[11px] leading-5 text-[#817b86]">{reason || "Sequence only asks for your address. You approve every action in your wallet."}</p>
          </div>
          <button autoFocus onClick={onClose} className="icon-button" aria-label="Close wallet selector">×</button>
        </div>

        {wallet.connected ? (
          <div className="mt-7 rounded-md bg-[#f8f7fc] p-5">
            <div className="flex items-center justify-between gap-4">
              <div><div className="text-[11px] font-bold text-[#302c34]">{wallet.walletName}</div><div className="mt-1 font-mono text-[9px] text-[#8d8792]">{shortAccount(wallet.account)}</div></div>
              <span className={`rounded-full px-2.5 py-1 text-[8px] font-bold uppercase tracking-[.1em] ${wallet.onShannon ? "bg-[#e8f7ef] text-[#40906b]" : "bg-[#fff0ec] text-[#d96e57]"}`}>{wallet.onShannon ? "Shannon" : "Wrong network"}</span>
            </div>
            <button onClick={() => { wallet.disconnect(); onClose(); }} className="mt-5 text-[10px] font-bold text-[#6f58c2]">Disconnect wallet</button>
          </div>
        ) : <div className="mt-7 space-y-2">
          {wallet.wallets.map((item) => (
            <button key={item.info.uuid} disabled={wallet.status === "connecting"} onClick={async () => { if (await wallet.connect(item)) { onConnected?.(); onClose(); } }} className="wallet-option">
              <span className="flex items-center gap-3">
                {item.info.icon ? <img src={item.info.icon} alt="" className="h-8 w-8 rounded-lg" /> : <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#efedff] text-[11px] font-extrabold text-[#6f58c2]">{item.info.name.slice(0, 1)}</span>}
                <span><strong className="block text-[12px] text-[#28252c]">{item.info.name}</strong><small className="mt-0.5 block text-[9px] text-[#aaa5ae]">{item.info.rdns || "Injected wallet"}</small></span>
              </span>
              <span className="text-[#aaa4ae]">→</span>
            </button>
          ))}
        </div>}

        {!wallet.connected && wallet.wallets.length === 0 && (
          <div className="rounded-md bg-[#f8f7fc] p-5">
            <div className="text-[11px] font-bold text-[#302c34]">No browser wallet detected</div>
            <p className="mt-2 text-[10px] leading-5 text-[#817b86]">Install an EVM wallet, then refresh Sequence.</p>
            <div className="mt-4 flex gap-4 text-[10px] font-bold text-[#6f58c2]"><a href="https://rabby.io/" target="_blank" rel="noreferrer">Get Rabby ↗</a><a href="https://metamask.io/" target="_blank" rel="noreferrer">Get MetaMask ↗</a></div>
          </div>
        )}
        {wallet.error && <p className="mt-4 text-[10px] font-semibold text-[#dc6e58]" role="alert">{wallet.error}</p>}
        <p className="mt-6 border-t border-[#ece9ef] pt-5 text-[9px] leading-4 text-[#aaa5ae]">Expected network: Somnia Shannon · Chain ID 50312</p>
      </section>
    </div>
  );
}
