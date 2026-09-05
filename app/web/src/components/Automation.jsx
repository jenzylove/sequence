import { useEffect, useState } from "react";
import { readManagerStake } from "../chain/vault.js";
import { addressUrl } from "../chain/config.js";
import { SHANNON } from "../chain/config.js";

const stt = (raw) => `${(Number(raw ?? 0n) / 1e18).toFixed(2)} STT`;

// Who pays for automatic execution.
//
// This used to ask each trader for a 32 STT stake before their sequence would
// run on its own. On a testnet whose faucet hands out a fraction of that, the
// honest reading is that "it runs while you sleep" was available to us and
// nobody else.
//
// Somnia charges the subscription owner and separately lets that owner name any
// contract as the handler, so Sequence owns the subscriptions and every user's
// own vault is the handler. Automatic is now the default and costs the trader
// nothing. This panel exists to say so plainly rather than to sell an upgrade.
export default function Automation({ vault, wallet }) {
  const [open, setOpen] = useState(false);
  const [stake, setStake] = useState(null);

  useEffect(() => {
    let live = true;
    readManagerStake().then((s) => live && setStake(s)).catch(() => {});
    return () => { live = false; };
  }, []);

  if (!vault.state || !vault.isOwner(wallet.account)) return null;

  return (
    <div className="workspace-card mt-8">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-7 py-5 text-left"
      >
        <div>
          <div className="text-[12px] font-bold text-[#28252c]">Automatic execution</div>
          <p className="mt-1 text-[10px] leading-[1.6] text-[#8b8590]">
            On by default. When a market settles, your sequence continues on its own — you do not need to be here, and it costs you nothing.
          </p>
        </div>
        <span className="flex items-center gap-3">
          <span className="rounded-full bg-[#eaf7f0] px-2.5 py-1 text-[8px] font-bold uppercase tracking-[.1em] text-[#40906b]">Included</span>
          <span className="text-[#aaa4ae]">{open ? "▲" : "▼"}</span>
        </span>
      </button>

      {open && (
        <div className="border-t border-[#ece9ef] px-7 py-6">
          <p className="max-w-[620px] text-[11px] leading-[1.75] text-[#5f5a66]">
            Somnia pushes a settled market's result straight into your account. The network asks whoever
            <em> subscribes</em> to hold a 32 STT stake, but lets the subscription point at any contract — so Sequence holds
            the stake and your own vault is what gets woken. You never stake anything, and your account stays yours: the
            subscription can only drive the rules you already armed, and it reads the outcome from the market itself.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-sm border border-[#ece9ef] bg-[#fbfbfc] p-4">
              <div className="text-[9px] uppercase tracking-[0.1em] text-[#a29da6]">You stake</div>
              <div className="mt-1 text-[16px] font-extrabold text-[#28252c]">Nothing</div>
            </div>
            <div className="rounded-sm border border-[#ece9ef] bg-[#fbfbfc] p-4">
              <div className="text-[9px] uppercase tracking-[0.1em] text-[#a29da6]">Sequence stakes</div>
              <div className="mt-1 text-[16px] font-extrabold text-[#28252c]">{stake === null ? "…" : stt(stake)}</div>
            </div>
          </div>
          <p className="mt-4 max-w-[620px] text-[10px] leading-[1.7] text-[#8b8590]">
            If a result ever fails to arrive, a settled market can also be pushed through manually with{" "}
            <strong className="font-semibold text-[#5f5a66]">Check result</strong>, which anyone can press. That is recovery,
            not how it normally works.
          </p>
          <a href={addressUrl(SHANNON.subscriptionManager)} target="_blank" rel="noreferrer"
            className="mt-4 inline-block text-[10px] font-bold text-[#6f58c2]">
            The contract that pays for it ↗
          </a>
        </div>
      )}
    </div>
  );
}
