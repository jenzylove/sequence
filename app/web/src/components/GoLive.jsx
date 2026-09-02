import { useState } from "react";
import { fmt } from "../sim.js";
import { txUrl } from "../chain/config.js";
import { fundVault, subscribeAllMarkets, approvePool } from "../chain/vault.js";

const SUBSCRIPTION_STAKE = 32n * 10n ** 18n;
const fmtSom = (raw) => `${(Number(raw) / 1e18).toFixed(2)} SOM`;

// The three owner transactions that take a deployed vault from readable to
// genuinely reactive. Each one is signed by the owner's own wallet; the panel
// only reports state it has read back from the chain.
export default function GoLive({ vault, wallet }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState({});

  const state = vault.state;
  if (!state || !vault.isOwner(wallet.account)) return null;

  const funded = state.native >= SUBSCRIPTION_STAKE;
  const collateralised = state.bankroll > 0n;
  const pools = [...new Set(vault.steps.filter((s) => s.exists && s.pool).map((s) => s.pool))];

  const run = async (label, fn) => {
    setError(null);
    setBusy(label);
    try {
      const result = await fn();
      setDone((cur) => ({ ...cur, [label]: result.hash }));
      await vault.refresh();
    } catch (cause) {
      setError(cause?.shortMessage || cause?.message || "The transaction did not go through.");
    } finally {
      setBusy(null);
    }
  };

  const steps = [
    {
      key: "fund",
      title: "Stake the subscription",
      detail: `Somnia Reactivity charges the 32 SOM subscription stake to the subscribing contract, so the vault has to hold it. Vault balance: ${fmtSom(state.native)}.`,
      complete: funded,
      action: "Send 32 SOM",
      run: () => fundVault({ provider: wallet.provider, account: wallet.account, value: SUBSCRIPTION_STAKE }),
    },
    {
      key: "subscribe",
      title: "Subscribe to OracleHub",
      detail: state.subscribed
        ? `Subscription ${state.subscriptionId.toString()} is live. Every AnswerDelivered resolution now reaches this vault.`
        : "Registers the vault's own filter on the OracleHub AnswerDelivered topic, so resolutions are delivered to it automatically.",
      complete: state.subscribed,
      blocked: !funded && "Stake the subscription first.",
      action: "Subscribe",
      run: () => subscribeAllMarkets({ provider: wallet.provider, account: wallet.account }),
    },
    {
      key: "approve",
      title: "Approve the successor pool",
      detail: collateralised
        ? `The vault holds ${fmt(state.bankroll)} of collateral. Approve the pool of an armed step so it can pull the bounded notional.`
        : "The vault holds no collateral yet. Send test USDC to the vault address, then approve the armed step's pool.",
      complete: false,
      blocked: (!collateralised && "Fund the vault with test USDC first.") || (pools.length === 0 && "Arm a step so there is a pool to approve."),
      action: "Approve pool",
      run: () => approvePool({ provider: wallet.provider, account: wallet.account, pool: pools[0], amount: state.maxOutstanding }),
    },
  ];

  return (
    <div className="workspace-card mt-10 p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="micro-label">Owner · go live</div>
          <h3 className="mt-2 text-[20px] font-extrabold tracking-[-.04em] text-[#151318]">Make the vault reactive</h3>
        </div>
        <span className="text-[10px] text-[#99949e]">You sign each transaction</span>
      </div>

      <div className="mt-7 grid gap-4 lg:grid-cols-3">
        {steps.map((step, index) => (
          <div key={step.key} className={`rounded-sm border p-5 ${step.complete ? "border-[#cfe8db] bg-[#f7fcf9]" : "border-[#ece9ef] bg-[#fbfbfc]"}`}>
            <div className="flex items-center justify-between">
              <span className={`grid h-[22px] w-[22px] place-items-center rounded-full border bg-white text-[9px] font-bold ${step.complete ? "border-[#55b58a] text-[#42946f]" : "border-[#8b72e8] text-[#7056c9]"}`}>{index + 1}</span>
              {step.complete && <span className="rounded-full bg-[#eaf7f0] px-2.5 py-1 text-[8px] font-bold uppercase tracking-[.1em] text-[#40906b]">Done</span>}
            </div>
            <div className="mt-4 text-[12px] font-bold text-[#28252c]">{step.title}</div>
            <p className="mt-2 text-[10px] leading-[1.65] text-[#7f7984]">{step.detail}</p>
            {!step.complete && (
              <button
                disabled={busy !== null || Boolean(step.blocked)}
                onClick={() => run(step.key, step.run)}
                className="soft-button mt-4 bg-[#111014] text-white disabled:opacity-35"
              >
                {busy === step.key ? "Confirm in wallet…" : step.action}
              </button>
            )}
            {step.blocked && !step.complete && <p className="mt-3 text-[9px] font-semibold text-[#a8a2ad]">{step.blocked}</p>}
            {done[step.key] && <a href={txUrl(done[step.key])} target="_blank" rel="noreferrer" className="mt-3 block text-[9px] font-bold text-[#6f58c2]">View transaction ↗</a>}
          </div>
        ))}
      </div>

      {error && <p className="mt-5 text-[10px] font-semibold text-[#dc6e58]" role="alert">{error}</p>}
    </div>
  );
}
