import { useState } from "react";
import { shortAccount } from "../hooks/useWallet.js";
import { fmt, KIND_LABEL } from "../sim.js";
import { txUrl, addressUrl, SHANNON } from "../chain/config.js";
import { cancelStep, setPaused } from "../chain/vault.js";
import GoLive from "./GoLive.jsx";

const TERMINAL = ["EXECUTED", "SKIPPED", "EXPIRED", "CANCELLED"];

// Every value rendered here is a contract read or a decoded contract event.
// Nothing on this screen is a placeholder; when the chain has nothing to show,
// the empty state says so rather than inventing a sequence.
export default function Operations({ wallet, vault, markets, onWallet, onBuild, onClose = null }) {
  const [view, setView] = useState("active");
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);

  const isOwner = vault.isOwner(wallet.account);
  const state = vault.state;
  const live = vault.steps.filter((s) => s.exists);
  const active = live.find((s) => !TERMINAL.includes(s.statusLabel)) || live[0] || null;
  const remaining = state ? state.maxOutstanding - state.outstanding : null;
  const usage = state && state.maxOutstanding > 0n
    ? Math.min(100, (Number(state.outstanding) / Number(state.maxOutstanding)) * 100)
    : 0;

  const runOwnerAction = async (label, fn) => {
    setActionError(null);
    setBusy(label);
    try {
      await fn();
      await vault.refresh();
    } catch (cause) {
      setActionError(cause?.shortMessage || cause?.message || "The transaction did not go through.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="how-it-works" className="operations-shell">
      <span id="onchain" className="block h-0" aria-hidden="true" />
      <div className="mx-auto max-w-[1280px] px-7 py-24 sm:px-12 lg:px-16 lg:py-32">
        <div className="grid gap-10 lg:grid-cols-[.95fr_1.05fr] lg:items-end">
          <div>
            <span className="section-tag bg-[#ff9b7f]">Onchain details</span>
            <h2 className="mt-5 max-w-[600px] text-[42px] font-extrabold leading-[1.03] tracking-[-0.055em] text-[#0b0a0e] sm:text-[54px]">Check the receipts.<br />Every step is public.</h2>
          </div>
          <div className="max-w-[480px] lg:justify-self-end"><p className="text-[14px] leading-[1.75] text-[#65616b]">This is the raw record: the contract that holds your funds, the exact rules it is enforcing, and every transition it has published, each with a transaction you can open yourself. You never need this page to trade, but it is always here.</p>{onClose && <button onClick={onClose} className="mt-5 text-[10px] font-semibold text-[#8f8994] transition hover:text-[#242128]">Back to your sequences</button>}</div>
        </div>

        <div className="wallet-strip mt-16">
          <div className="flex items-center gap-4">
            <span className={`grid h-10 w-10 place-items-center rounded-full ${wallet.connected ? "bg-[#e8f7ef]" : "bg-[#f1eef5]"}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${wallet.connected ? "bg-[#55b58a]" : "bg-[#aaa4ae]"}`} />
            </span>
            <div>
              <div className="text-[12px] font-bold text-[#242128]">{wallet.connected ? `${wallet.walletName} connected` : "Connect to arm this sequence"}</div>
              <div className="mt-1 text-[10px] text-[#99949e]">{wallet.connected
                ? `${shortAccount(wallet.account)} · ${wallet.onShannon ? "Shannon testnet" : `Chain ${parseInt(wallet.chainId, 16)}`}${isOwner ? " · vault owner" : ""}`
                : "Build and simulate without connecting. A wallet is only needed to fund and arm."}</div>
            </div>
          </div>
          {wallet.connected ? (
            <div className="flex items-center gap-8">
              <WalletMetric label="Account" value={shortAccount(wallet.account)} />
              <WalletMetric label="Network" value={wallet.onShannon ? "Shannon" : "Switch required"} />
              {!wallet.onShannon && <button onClick={wallet.switchNetwork} className="soft-button bg-[#111014] text-white">Switch to Shannon</button>}
              <button onClick={wallet.disconnect} className="text-[10px] font-semibold text-[#8f8994] hover:text-[#242128]">Disconnect</button>
            </div>
          ) : <button onClick={onWallet} className="soft-button bg-[#111014] text-white">Connect wallet</button>}
        </div>

        <div className="mt-6 flex gap-7 border-b border-[#e5e1e8]">
          <button onClick={() => { setView("active"); document.getElementById("active-sequence")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} className={`state-tab ${view === "active" ? "is-active" : ""}`}>Active sequence</button>
          <button onClick={() => { setView("history"); document.getElementById("proof")?.scrollIntoView({ behavior: "smooth", block: "center" }); }} className={`state-tab ${view === "history" ? "is-active" : ""}`}>Execution proof</button>
        </div>

        <div className="mt-10 grid gap-12 lg:grid-cols-[.9fr_1.1fr] lg:items-start">
          <div className="relative min-h-[600px]">
            <div className="absolute left-4 top-6 h-16 w-16 dotted-coral opacity-50" />
            <div className="absolute bottom-10 right-3 h-32 w-48 bg-[#c6f3f7] [clip-path:polygon(12%_0,100%_16%,88%_100%,0_78%)]" />
            <svg className="absolute left-0 top-32 h-52 w-32" viewBox="0 0 130 210" fill="none" aria-hidden="true"><path d="M8 20c82 0 4 82 74 89 58 6 40 59 6 82" stroke="#39353d" strokeWidth="1"/><path d="m88 191-3-11m3 11 11-5" stroke="#39353d" strokeWidth="1"/></svg>

            <article id="active-sequence" className="active-card relative z-[2] ml-auto max-w-[430px]">
              <div className="flex items-center justify-between border-b border-[#ece9ef] px-7 py-5">
                <div className="flex items-center gap-3">
                  <span className={`h-2 w-2 rounded-full ${state?.paused ? "bg-[#e28e75] shadow-[0_0_0_5px_rgba(226,142,117,.12)]" : active ? "bg-[#55b58a] shadow-[0_0_0_5px_rgba(85,181,138,.12)]" : "bg-[#c7c2ca]"}`} />
                  <span className="text-[11px] font-bold text-[#2a272e]">{state?.paused ? "Vault paused" : active ? `Sequence ${active.statusLabel.toLowerCase()}` : "No step armed"}</span>
                </div>
                <a href={addressUrl(vault.address)} target="_blank" rel="noreferrer" className="font-mono text-[9px] text-[#a19ca5] hover:text-[#6f58c2]">{vault.address.slice(0, 6)}…{vault.address.slice(-4)} ↗</a>
              </div>

              <div className="p-7">
                {vault.status === "error" ? (
                  <div className="text-[11px] leading-[1.7] text-[#dc6e58]">
                    Could not read the vault on Shannon. {vault.error}
                    <button onClick={vault.refresh} className="ml-2 font-bold text-[#6f58c2]">Retry</button>
                  </div>
                ) : !state ? (
                  <div className="text-[11px] text-[#8d8792]">Reading vault state from Shannon…</div>
                ) : (
                  <>
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="micro-label">{active ? "Waiting for" : "Vault"}</div>
                        <h3 className="mt-2 max-w-[260px] text-[20px] font-extrabold leading-[1.15] tracking-[-.04em] text-[#151318]">
                          {active ? (active.triggerLabel || "A DreamDEX settlement") : "Nothing armed yet"}
                        </h3>
                      </div>
                      {live.length > 0 && <span className="text-[10px] font-semibold text-[#8b72e8]">{live.filter((s) => !TERMINAL.includes(s.statusLabel)).length} live</span>}
                    </div>

                    <div className="mt-7 h-1 overflow-hidden rounded-full bg-[#ebe8ee]"><div className="h-full rounded-full bg-[#8b72e8] transition-all" style={{ width: `${usage}%` }} /></div>

                    <div className="mt-8 grid grid-cols-3 gap-4 border-y border-[#ece9ef] py-6">
                      <StateMetric label="Committed" value={fmt(state.outstanding)} />
                      <StateMetric label="Vault cap" value={fmt(state.maxOutstanding)} />
                      <StateMetric label="Remaining" value={fmt(remaining)} />
                    </div>

                    {active ? (
                      <div className="mt-7 rounded-sm border-l-[3px] border-[#8b72e8] bg-[#f8f7fc] p-5">
                        <div className="micro-label">Armed successor</div>
                        <div className="mt-3 flex items-start justify-between gap-5">
                          <div>
                            <div className="text-[13px] font-bold text-[#28252c]">{active.successorLabel || "Successor pool"}</div>
                            <div className="mt-1.5 text-[10px] text-[#85808a]">If YES → {sideLabel(active.actionOnWin0)} · If NO → {sideLabel(active.actionOnWin1)} · up to {fmt(active.notionalCap)}</div>
                            <a href={addressUrl(active.pool)} target="_blank" rel="noreferrer" className="mt-2 block font-mono text-[9px] text-[#a19ca5] hover:text-[#6f58c2]">pool {active.pool.slice(0, 10)}… ↗</a>
                          </div>
                          <span className="rounded-full bg-[#eeeafd] px-2.5 py-1 text-[8px] font-bold uppercase tracking-[.1em] text-[#7056c9]">{active.statusLabel}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-7 rounded-sm border-l-[3px] border-[#ded9e3] bg-[#fbfbfc] p-5">
                        <div className="micro-label">Nothing waiting</div>
                        <p className="mt-2 text-[10px] leading-[1.65] text-[#85808a]">Build a bounded step and arm it from the builder. Once armed, its live status and every transition appear here from vault state.</p>
                      </div>
                    )}

                    {!state.subscribed && (
                      <p className="mt-5 rounded-sm bg-[#fff8f4] p-4 text-[10px] leading-[1.6] text-[#a8724f]">
                        This vault holds no Somnia Reactivity subscription yet, so resolutions are not being delivered to it. Subscribing requires 32 SOM staked from the vault.
                      </p>
                    )}

                    <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
                      <button onClick={onBuild} className="text-[10px] font-bold text-[#2a272e]">Review in builder</button>
                      {isOwner && (
                        <div className="flex items-center gap-4">
                          {active && !TERMINAL.includes(active.statusLabel) && (
                            <button disabled={busy !== null} onClick={() => runOwnerAction("cancel", () => cancelStep({ provider: wallet.provider, account: wallet.account, stepId: active.stepId }))} className="text-[10px] font-semibold text-[#8f8994] hover:text-[#dc6e58] disabled:opacity-40">
                              {busy === "cancel" ? "Cancelling…" : "Cancel step"}
                            </button>
                          )}
                          <button disabled={busy !== null} onClick={() => runOwnerAction("pause", () => setPaused({ provider: wallet.provider, account: wallet.account, paused: !state.paused }))} className="text-[10px] font-semibold text-[#8f8994] hover:text-[#242128] disabled:opacity-40">
                            {busy === "pause" ? "Sending…" : state.paused ? "Unpause vault" : "Pause vault"}
                          </button>
                        </div>
                      )}
                    </div>
                    {actionError && <p className="mt-3 text-[10px] font-semibold text-[#dc6e58]" role="alert">{actionError}</p>}
                  </>
                )}
              </div>
            </article>
          </div>

          <article id="proof" className="proof-card">
            <div className="flex items-start justify-between gap-6 border-b border-[#ece9ef] px-7 py-6">
              <div><div className="micro-label">Execution proof</div><h3 className="mt-2 text-[24px] font-extrabold tracking-[-.04em] text-[#151318]">A readable onchain trail</h3></div>
              <span className="rounded-full bg-[#eaf7f0] px-3 py-1.5 text-[8px] font-bold uppercase tracking-[.1em] text-[#40906b]">Vault events</span>
            </div>

            <div className="px-7 py-3">
              {vault.events.length === 0 ? (
                <div className="py-8 text-[11px] leading-[1.75] text-[#7f7984]">
                  No SequenceVault events in the scanned window yet. Arm a step from the builder and every transition the vault emits — armed, triggered, executed or skipped — is decoded here with its transaction hash.
                </div>
              ) : vault.events.map((item, index) => {
                const row = describe(item);
                return (
                  <div key={`${item.txHash}-${item.logIndex}`} className="proof-row">
                    <div className="font-mono text-[9px] text-[#aaa5ae]">#{item.blockNumber.toString().slice(-6)}</div>
                    <div className="relative pl-7">
                      {index < vault.events.length - 1 && <span className="absolute left-[5px] top-5 h-[calc(100%+20px)] w-px bg-[#e2dee5]" />}
                      <span className={`proof-dot ${row.tone}`} />
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <h4 className="text-[12px] font-bold text-[#2a272e]">{row.title}</h4>
                        <a href={txUrl(item.txHash)} target="_blank" rel="noreferrer" className="text-[8px] font-bold uppercase tracking-[.12em] text-[#a19ca5] hover:text-[#6f58c2]">{item.txHash.slice(0, 10)}… ↗</a>
                      </div>
                      <p className="mt-2 max-w-[390px] text-[10px] leading-[1.65] text-[#7f7984]">{row.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#faf9fb] px-7 py-5">
              <span className="font-mono text-[9px] text-[#99949e]">AnswerDelivered(uint256,bytes32,uint32,uint256[],bool)</span>
              <a href="https://github.com/jenzylove/sequence/blob/main/docs/VERIFIED.md" target="_blank" rel="noreferrer" className="text-[9px] font-bold text-[#6f58c2]">View provenance ↗</a>
            </div>
          </article>
        </div>

        <GoLive vault={vault} wallet={wallet} />

        <p className="mt-10 text-center font-mono text-[9px] uppercase tracking-[.12em] text-[#a19ca5]">
          Vault {vault.address} · {SHANNON.name} · chain {SHANNON.chainId}
        </p>
      </div>
    </section>
  );
}

// Decodes one real vault event into the sentence the operator needs.
function describe(item) {
  const a = item.args || {};
  switch (item.name) {
    case "StepArmed":
      return { tone: "violet", title: "Step armed", detail: `The owner armed a bounded successor on pool ${short(a.pool)}, watching market ${short(a.triggerMarketId)}.` };
    case "Triggered":
      return { tone: "cyan", title: "Resolution delivered", detail: `Somnia Reactivity delivered market ${short(a.marketId)}. ${a.voided ? "The market voided." : `Outcome ${a.winningOutcome} won.`}` };
    case "Executed":
      return { tone: "green", title: "Bounded order placed", detail: `${KIND_LABEL[Number(a.kind)]} for ${fmt(a.notional)} on ${short(a.pool)}. Order id ${a.orderId?.toString()}, pool reported ${a.success ? "success" : "failure"}.` };
    case "Skipped":
      return { tone: "coral", title: "Successor skipped", detail: `The vault declined to place: ${a.reason}. Nothing was committed.` };
    case "StepCancelled":
      return { tone: "coral", title: "Step cancelled", detail: `The owner cancelled step ${short(a.stepId)} before it could fire.` };
    case "PausedSet":
      return { tone: "coral", title: a.paused ? "Vault paused" : "Vault unpaused", detail: a.paused ? "Execution is halted; deliveries revert until unpaused." : "Execution re-enabled by the owner." };
    default:
      return { tone: "violet", title: item.name, detail: "Vault event." };
  }
}

const sideLabel = (a) => (a === 255 ? "stop" : a === 2 ? "buy NO" : "buy YES");

const short = (v) => (typeof v === "string" && v.length > 14 ? `${v.slice(0, 8)}…${v.slice(-4)}` : String(v));

function WalletMetric({ label, value }) { return <div className="hidden sm:block"><div className="text-[8px] font-bold uppercase tracking-[.12em] text-[#aaa5ae]">{label}</div><div className="mt-1 text-[10px] font-semibold text-[#302c34]">{value}</div></div>; }
function StateMetric({ label, value }) { return <div><div className="text-[8px] font-bold uppercase tracking-[.12em] text-[#aaa5ae]">{label}</div><div className="mt-1.5 text-[13px] font-bold text-[#302c34]">{value}</div></div>; }
