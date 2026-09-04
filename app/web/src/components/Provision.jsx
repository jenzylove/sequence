import { useState } from "react";
import ScreenHeader from "./ScreenHeader.jsx";
import { createVault } from "../chain/vault.js";
import { txUrl } from "../chain/config.js";
import { money } from "../lib/language.js";

const DEFAULT_LIMIT = 5000000n; // $5.00

// What a wallet with no trading account sees.
//
// Before this existed the product was single-tenant: every visitor read one
// vault they did not own, and could do nothing with it. Now a new wallet is
// offered its own account, which it alone controls.
export default function Provision({ wallet, vault, onReady }) {
  const [limit, setLimit] = useState(String(Number(DEFAULT_LIMIT) / 1e6));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const value = BigInt(Math.max(0, Math.round(Number(limit || 0) * 1e6)));
  const ready = wallet.connected && wallet.onShannon && value > 0n && !busy;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await createVault({
        provider: wallet.provider, account: wallet.account, maxOutstanding: value,
      });
      setDone(result);
      vault.adopt(result.vault);
      onReady?.(result.vault);
    } catch (cause) {
      setError(cause?.shortMessage || cause?.message || "That did not go through. Nothing was created.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="provision" className="dashboard-shell">
      <div className="mx-auto max-w-[1280px] px-7 py-14 sm:px-12 lg:px-16 lg:py-16">
        <ScreenHeader
          trail={[{ label: "Get set up" }]}
          tag="Get set up"
          title="Create your trading account."
          blurb="Sequence trades from an account that only you control. It is yours: you fund it, you set its limit, and you can empty it at any time. Nobody else can arm it, pause it, or move anything out of it."
        />

        <div className="workspace-card mt-10 max-w-[720px]">
          <div className="p-7 lg:p-9">
            <ol className="space-y-5">
              <Point n={1} title="It belongs to your wallet">
                Created for {wallet.account ? `${wallet.account.slice(0, 6)}…${wallet.account.slice(-4)}` : "your wallet"}, and owned by it from the moment it exists.
              </Point>
              <Point n={2} title="You choose the ceiling">
                No sequence can put more than this at risk at once. Your account enforces it itself, and you can change it later.
              </Point>
              <Point n={3} title="Funding comes after">
                Creating the account moves no money. You send it what you want to trade with once it exists.
              </Point>
            </ol>

            <label className="mt-8 block max-w-[240px]">
              <span className="mb-2 block text-[9px] font-bold uppercase tracking-[.12em] text-[#9d98a2]">Most at risk at once</span>
              <div className="input-prefix">
                <span>$</span>
                <input
                  type="number" step="1" min="0"
                  aria-label="Most at risk at once"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                />
              </div>
            </label>

            {done ? (
              <div className="mt-8">
                <p className="text-[12px] font-semibold text-[#40906b]">
                  Your account is ready. It will hold up to {money(value)} at risk.
                </p>
                <a href={txUrl(done.hash)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[10px] font-bold text-[#6f58c2]">Receipt ↗</a>
              </div>
            ) : (
              <div className="mt-8">
                <button disabled={!ready} onClick={create} className="soft-button bg-[#111014] px-6 py-3 text-white disabled:opacity-35">
                  {busy ? "Approve in your wallet…" : "Create my account"}
                </button>
                {!wallet.onShannon && wallet.connected && (
                  <p className="mt-3 text-[10px] font-semibold text-[#a8a2ad]">Switch your wallet to the Somnia network first.</p>
                )}
                {error && <p className="mt-3 text-[10px] font-semibold text-[#dc6e58]" role="alert">{error}</p>}
                <p className="mt-3 text-[10px] leading-[1.55] text-[#a19ca5]">One transaction. It creates the account and nothing else.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Point({ n, title, children }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border border-[#8b72e8] text-[9px] font-bold text-[#7056c9]">{n}</span>
      <div>
        <div className="text-[12px] font-bold text-[#28252c]">{title}</div>
        <p className="mt-1.5 text-[11px] leading-[1.7] text-[#7f7984]">{children}</p>
      </div>
    </li>
  );
}
