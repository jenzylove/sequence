import { useEffect, useState } from "react";
import { fmt } from "../sim.js";
import TxState from "./TxState.jsx";
import { fundVault, subscribeAllMarkets, ensurePoolAllowances } from "../chain/vault.js";
import { readWalletReadiness, checkGasForTransfer, som, FAUCET_URL, DREAMDEX_URL } from "../chain/preflight.js";
import { useTx } from "../hooks/useTx.js";

const SUBSCRIPTION_STAKE = 32n * 10n ** 18n;
const fmtSom = (raw) => `${(Number(raw) / 1e18).toFixed(2)} STT`;

// Getting a new account ready to trade.
//
// This panel used to lead with a 32 STT stake and present it as step one of
// required setup. A wallet funded from the public faucet holds a fraction of
// that, so the first thing most people met was a wall — and the wall was not
// even necessary: a sequence runs perfectly well without it, because anyone can
// push a settled result through and the account acts on it. That step is now
// what it always was, an optional upgrade, and it is ordered last.
export default function GoLive({ vault, wallet }) {
  const [readiness, setReadiness] = useState(null);
  const [openStep, setOpenStep] = useState(null);
  const tx = useTx();

  const state = vault.state;

  useEffect(() => {
    let live = true;
    if (!wallet.account) return undefined;
    readWalletReadiness(wallet.account).then((r) => live && setReadiness(r)).catch(() => {});
    return () => { live = false; };
  }, [wallet.account, state?.bankroll, state?.native]);

  if (!state || !vault.isOwner(wallet.account)) return null;

  const funded = state.native >= SUBSCRIPTION_STAKE;
  const shortfall = funded ? 0n : SUBSCRIPTION_STAKE - state.native;
  const collateralised = state.bankroll > 0n;
  const walletCanStake = readiness ? readiness.native >= shortfall : true;
  const pools = [...new Set(vault.steps.filter((s) => s.exists && s.pool).map((s) => s.pool))];

  const run = async (key, send, preflight) => {
    setOpenStep(key);
    const result = await tx.run({ preflight, send });
    if (result.ok) await vault.refresh();
  };

  const steps = [
    {
      key: "collateral",
      title: "Put trading funds in",
      required: true,
      detail: collateralised
        ? `Your account holds ${fmt(state.bankroll)} of test USDC to trade with.`
        : "Your account needs test USDC before it can place a trade. Send it from your wallet to your account address below.",
      complete: collateralised,
      body: !collateralised && (
        <div className="mt-3 space-y-2">
          <div className="rounded-sm bg-white p-2.5">
            <div className="text-[8px] font-bold uppercase tracking-[.1em] text-[#a29da6]">Your account address</div>
            <code className="mt-1 block break-all font-mono text-[9px] text-[#4b4650]">{vault.address}</code>
          </div>
          <p className="text-[9px] leading-[1.6] text-[#8b8590]">
            {readiness && readiness.usdc > 0n
              ? `Your wallet holds $${(Number(readiness.usdc) / 1e6).toFixed(2)} of test USDC. Send some to the address above.`
              : "Your wallet holds no test USDC yet. Get some from DreamDEX, then send it here."}
          </p>
          <a href={DREAMDEX_URL} target="_blank" rel="noreferrer" className="inline-block text-[9px] font-bold text-[#6f58c2]">Get test USDC ↗</a>
        </div>
      ),
    },
    {
      key: "approve",
      title: "Let it place your trades",
      required: true,
      detail: collateralised
        ? "Give each market permission to draw on your account, up to your limit and no further."
        : "Once your account holds funds, you give each market permission to draw on it — never more than your limit.",
      complete: false,
      blocked: (!collateralised && "Put trading funds in first.")
        || (pools.length === 0 && "Build and activate a sequence first, so there is a market to approve."),
      action: "Give permission",
      send: (onHash) => ensurePoolAllowances({
        provider: wallet.provider, account: wallet.account,
        vault: vault.address, collateral: state.collateral,
        pools, amount: state.maxOutstanding, onHash,
      }),
    },
    {
      key: "auto",
      title: "Run it hands-free",
      optional: true,
      detail: state.subscribed
        ? "Your account is subscribed. Settled markets reach it automatically."
        : funded
          ? `Your account holds the ${fmtSom(SUBSCRIPTION_STAKE)} stake. Subscribe and settled markets will reach it on their own.`
          : `Optional. The network asks any account that wants results pushed to it to hold a ${fmtSom(SUBSCRIPTION_STAKE)} stake. Without it your sequence still runs — you or anyone else presses "Check result" once a market settles, and your account acts on it exactly the same way.`,
      complete: state.subscribed,
      blocked: !funded && !walletCanStake
        ? `Needs ${fmtSom(shortfall)} more in your account, and your wallet holds ${som(readiness?.native ?? 0n, 2)}. Your sequences work without this.`
        : null,
      action: funded ? "Subscribe" : `Stake ${fmtSom(shortfall)}`,
      preflight: funded ? undefined : () => checkGasForTransfer({ account: wallet.account, to: vault.address, value: shortfall }),
      send: funded
        ? (onHash) => subscribeAllMarkets({ provider: wallet.provider, account: wallet.account, vault: vault.address, onHash })
        : (onHash) => fundVault({ provider: wallet.provider, account: wallet.account, vault: vault.address, value: shortfall, onHash }),
    },
  ];

  const requiredLeft = steps.filter((s) => s.required && !s.complete).length;

  return (
    <div className="workspace-card mt-10 p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="micro-label">Get ready to trade</div>
          <h3 className="mt-2 text-[20px] font-extrabold tracking-[-.04em] text-[#151318]">Set your account up</h3>
        </div>
        <span className="text-[10px] text-[#99949e]">
          {requiredLeft === 0 ? "Everything required is done" : `${requiredLeft} step${requiredLeft > 1 ? "s" : ""} left · you sign each one`}
        </span>
      </div>

      <div className="mt-7 grid gap-4 lg:grid-cols-3">
        {steps.map((step, index) => (
          <div key={step.key} className={`rounded-sm border p-5 ${step.complete ? "border-[#cfe8db] bg-[#f7fcf9]" : "border-[#ece9ef] bg-[#fbfbfc]"}`}>
            <div className="flex items-center justify-between">
              <span className={`grid h-[22px] w-[22px] place-items-center rounded-full border bg-white text-[9px] font-bold ${step.complete ? "border-[#55b58a] text-[#42946f]" : "border-[#8b72e8] text-[#7056c9]"}`}>{index + 1}</span>
              {step.complete
                ? <span className="rounded-full bg-[#eaf7f0] px-2.5 py-1 text-[8px] font-bold uppercase tracking-[.1em] text-[#40906b]">Done</span>
                : step.optional && <span className="rounded-full bg-[#f2f0f7] px-2.5 py-1 text-[8px] font-bold uppercase tracking-[.1em] text-[#8b8590]">Optional</span>}
            </div>
            <div className="mt-4 text-[12px] font-bold text-[#28252c]">{step.title}</div>
            <p className="mt-2 text-[10px] leading-[1.65] text-[#7f7984]">{step.detail}</p>
            {step.body}

            {!step.complete && step.action && (
              <button
                disabled={tx.busy || Boolean(step.blocked)}
                onClick={() => run(step.key, step.send, step.preflight)}
                className="soft-button mt-4 bg-[#111014] text-white disabled:opacity-35"
              >
                {tx.busy && openStep === step.key ? "Working…" : step.action}
              </button>
            )}
            {step.blocked && !step.complete && <p className="mt-3 text-[9px] font-semibold text-[#a8a2ad]">{step.blocked}</p>}
            {openStep === step.key && <TxState tx={tx} />}
          </div>
        ))}
      </div>

      {readiness && !readiness.canPayGas && (
        <div className="mt-5 rounded-sm border border-[#f0dcc6] bg-[#fdf8f1] p-4">
          <div className="text-[11px] font-bold text-[#8a6a34]">Your wallet is low on test STT</div>
          <p className="mt-1.5 text-[10px] leading-[1.65] text-[#7d6b52]">
            Every step here costs a small network fee, and your wallet holds {som(readiness.native)}. Top up before you sign anything.
          </p>
          <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="mt-3 inline-block text-[10px] font-bold text-[#6f58c2]">Get test STT ↗</a>
        </div>
      )}
    </div>
  );
}
