import { useEffect, useMemo, useState } from "react";
import MarketContext from "./MarketContext.jsx";
import CommandBar from "./CommandBar.jsx";
import ActivateDialog from "./ActivateDialog.jsx";
import LimitDialog from "./LimitDialog.jsx";
import { statusCopy, bucketFor, money, countdown, marketHeadline } from "../lib/language.js";
import { explainEvent } from "../lib/command.js";
import { loadDrafts, upsertDraft, removeDraft } from "../lib/store.js";
import { notionalOf } from "../strategy.js";
import { cancelStep } from "../chain/vault.js";

const TABS = [
  { key: "draft", label: "Drafts" },
  { key: "active", label: "Live" },
  { key: "completed", label: "Finished" },
];

// The post-connect home. It answers, without jargon: what is running, what is it
// waiting for, what happens next, and how much is at risk. Everything shown is
// either a contract read or a decoded contract event.
export default function Dashboard({ markets, vault, wallet, onOpenBuilder, onEditDraft, onOpenDetails }) {
  const [tab, setTab] = useState("active");
  const [drafts, setDrafts] = useState(() => loadDrafts());
  const [pending, setPending] = useState(null);
  const [limitOpen, setLimitOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const state = vault.state;
  const onchain = vault.steps.filter((s) => s.exists);
  const active = onchain.filter((s) => bucketFor(s.statusLabel) === "active");
  const completed = onchain.filter((s) => bucketFor(s.statusLabel) === "completed");

  // Default to whichever list actually has something in it.
  useEffect(() => {
    if (active.length === 0 && tab === "active") setTab(drafts.length ? "draft" : completed.length ? "completed" : "active");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.status]);

  const counts = { draft: drafts.length, active: active.length, completed: completed.length };
  const headroom = state ? state.maxOutstanding - state.outstanding : null;
  const usage = state && state.maxOutstanding > 0n ? Math.min(100, (Number(state.outstanding) / Number(state.maxOutstanding)) * 100) : 0;

  const recent = useMemo(
    () => vault.events.filter((e) => ["Executed", "Skipped", "Triggered"].includes(e.name)).slice(-4).reverse(),
    [vault.events],
  );

  const saveDraft = (strategy) => {
    const saved = upsertDraft(strategy);
    setDrafts(loadDrafts());
    return saved;
  };
  const dropDraft = (id) => setDrafts(removeDraft(id));

  const stopSequence = async (step) => {
    setBusy(step.stepId);
    try {
      await cancelStep({ provider: wallet.provider, account: wallet.account, stepId: step.stepId });
      await vault.refresh();
    } catch { /* surfaced by the vault read on refresh */ } finally { setBusy(null); }
  };

  const setupDone = Boolean(state?.subscribed && state?.bankroll > 0n);

  return (
    <section id="dashboard" className="dashboard-shell">
      <div className="mx-auto max-w-[1280px] px-7 py-16 sm:px-12 lg:px-16 lg:py-20">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className="section-tag bg-[#8b72e8]">Your sequences</span>
            <h2 className="mt-5 text-[36px] font-extrabold leading-[1.05] tracking-[-0.055em] text-[#0b0a0e] sm:text-[44px]">
              {active.length > 0 ? "Running without you." : "Set the next move."}
            </h2>
            <button onClick={onOpenBuilder} className="soft-button mt-6 bg-[#111014] px-6 py-3 text-white">New sequence</button>
          </div>
          {state && (
            <div className="risk-summary">
              <div>
                <div className="text-[8px] font-bold uppercase tracking-[.12em] text-[#aaa5ae]">At risk now</div>
                <div className="mt-1.5 text-[20px] font-extrabold tracking-[-.04em] text-[#161419]">{money(state.outstanding)}</div>
              </div>
              <div className="h-8 w-px bg-[#e5e1e8]" />
              <button onClick={() => setLimitOpen(true)} className="group text-left" aria-label="Change your risk limit">
                <div className="text-[8px] font-bold uppercase tracking-[.12em] text-[#aaa5ae]">Your limit</div>
                <div className="mt-1.5 flex items-baseline gap-1.5">
                  <span className="text-[20px] font-extrabold tracking-[-.04em] text-[#161419]">{money(state.maxOutstanding)}</span>
                  <span className="text-[9px] font-semibold text-[#a19ca5] transition group-hover:text-[#6f58c2]">change</span>
                </div>
              </button>
              <div className="h-8 w-px bg-[#e5e1e8]" />
              <div>
                <div className="text-[8px] font-bold uppercase tracking-[.12em] text-[#aaa5ae]">Still free</div>
                <div className="mt-1.5 text-[20px] font-extrabold tracking-[-.04em] text-[#40906b]">{money(headroom)}</div>
              </div>
            </div>
          )}
        </div>

        {state && (
          <div className="mt-5 h-1 max-w-[420px] overflow-hidden rounded-full bg-[#ebe8ee]">
            <div className="h-full rounded-full bg-[#8b72e8] transition-all" style={{ width: `${usage}%` }} />
          </div>
        )}

        {!setupDone && (
          <div className="setup-banner mt-8">
            <div>
              <div className="text-[12px] font-bold text-[#242128]">One-time setup is not finished</div>
              <p className="mt-1.5 text-[10px] leading-[1.6] text-[#8a5f47]">
                {!state?.subscribed
                  ? "Your account is not listening for market results yet, so nothing will run on its own."
                  : "Your account holds no funds to trade with yet."}
              </p>
            </div>
            <button onClick={onOpenDetails} className="soft-button bg-[#111014] text-white">Finish setup</button>
          </div>
        )}

        {state?.paused && (
          <div className="setup-banner mt-8">
            <div>
              <div className="text-[12px] font-bold text-[#242128]">Trading is paused</div>
              <p className="mt-1.5 text-[10px] leading-[1.6] text-[#8a5f47]">Nothing will run until you resume it.</p>
            </div>
            <button onClick={onOpenDetails} className="soft-button bg-[#111014] text-white">Manage</button>
          </div>
        )}

        <div className="mt-10">
          <MarketContext markets={markets} />
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1.15fr_.85fr] lg:items-start">
          <CommandBar
            markets={markets}
            vault={vault}
            onOpenBuilder={onOpenBuilder}
            // Save first so the draft carries an id, and hand that same object
            // to the dialog: re-reviewing updates one draft instead of piling
            // up copies, and activating it clears the right one.
            onReview={(strategy) => {
              const saved = saveDraft(strategy);
              strategy.id = saved.id;
              setPending(saved);
            }}
          />

          <div className="sequence-panel">
            <div className="flex gap-6 border-b border-[#e5e1e8] px-6 pt-5">
              {TABS.map((t) => (
                <button key={t.key} onClick={() => setTab(t.key)} className={`state-tab ${tab === t.key ? "is-active" : ""}`}>
                  {t.label}{counts[t.key] > 0 && <span className="ml-1.5 text-[9px] text-[#a19ca5]">{counts[t.key]}</span>}
                </button>
              ))}
            </div>

            <div className="p-6">
              {tab === "draft" && (
                drafts.length === 0
                  ? <Empty>Nothing saved yet. Describe a sequence and it will land here before it goes live.</Empty>
                  : <div className="space-y-3">
                      {drafts.map((d) => (
                        <div key={d.id} className="sequence-row">
                          <div>
                            <div className="text-[12px] font-bold text-[#252229]">{d.name}</div>
                            <div className="mt-1.5 text-[10px] text-[#817c86]">
                              {d.steps.length} step{d.steps.length > 1 ? "s" : ""} · risks up to {money(d.maxOutstanding)}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <button onClick={() => setPending(d)} className="soft-button bg-[#111014] text-white">Activate</button>
                            <button onClick={() => onEditDraft(d)} className="text-[10px] font-semibold text-[#8f8994] hover:text-[#242128]">Edit</button>
                            <button onClick={() => dropDraft(d.id)} className="text-[10px] font-semibold text-[#aaa4ae] hover:text-[#dc6e58]">Delete</button>
                          </div>
                        </div>
                      ))}
                    </div>
              )}

              {tab === "active" && (
                active.length === 0
                  ? <Empty>Nothing is live. Anything you activate will show here with what it is waiting for.</Empty>
                  : <div className="space-y-3">
                      {active.map((s) => {
                        const market = markets.open.find((m) => m.marketId?.toLowerCase() === s.triggerMarketId?.toLowerCase());
                        const copy = statusCopy(s.statusLabel);
                        return (
                          <div key={s.stepId} className="sequence-row is-live">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="h-1.5 w-1.5 rounded-full bg-[#55b58a]" />
                                <span className="text-[12px] font-bold text-[#252229]">{market ? marketHeadline(market) : (s.triggerLabel || "Waiting on a market")}</span>
                              </div>
                              <div className="mt-1.5 text-[10px] leading-[1.55] text-[#817c86]">
                                {copy.blurb} {market?.expiry ? `Settles ${countdown(market.expiry)}.` : ""}
                              </div>
                              <div className="mt-1.5 text-[10px] text-[#a19ca5]">
                                Then {s.actionOnWin0 === 255 && s.actionOnWin1 === 255 ? "does nothing" : `buys ${s.actionOnWin0 === 255 ? (s.actionOnWin1 === 2 ? "NO" : "YES") : (s.actionOnWin0 === 2 ? "NO" : "YES")} on one side`} · at most {money(s.notionalCap)}
                              </div>
                            </div>
                            <button disabled={busy === s.stepId} onClick={() => stopSequence(s)} className="text-[10px] font-semibold text-[#8f8994] hover:text-[#dc6e58] disabled:opacity-40">
                              {busy === s.stepId ? "Stopping…" : "Stop"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
              )}

              {tab === "completed" && (
                completed.length === 0
                  ? <Empty>Nothing has finished yet. Once a market settles, the result lands here.</Empty>
                  : <div className="space-y-3">
                      {completed.map((s) => {
                        const copy = statusCopy(s.statusLabel);
                        return (
                          <div key={s.stepId} className="sequence-row">
                            <div>
                              <div className="text-[12px] font-bold text-[#252229]">{s.triggerLabel ? marketHeadline({ question: s.triggerLabel, asset: "" }) : "Sequence"}</div>
                              <div className="mt-1.5 text-[10px] text-[#817c86]">{copy.blurb}</div>
                            </div>
                            <span className={`status-pill ${copy.tone}`}>{copy.label}</span>
                          </div>
                        );
                      })}
                    </div>
              )}
            </div>

            {recent.length > 0 && (
              <div className="border-t border-[#ece9ef] px-6 py-5">
                <div className="micro-label">Just happened</div>
                <ul className="mt-3 space-y-2.5">
                  {recent.map((e) => (
                    <li key={`${e.txHash}-${e.logIndex}`} className="text-[10px] leading-[1.6] text-[#7f7984]">{explainEvent(e)}</li>
                  ))}
                </ul>
                <button onClick={onOpenDetails} className="mt-4 text-[10px] font-bold text-[#6f58c2]">Onchain details →</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {limitOpen && <LimitDialog vault={vault} wallet={wallet} onClose={() => setLimitOpen(false)} />}

      {pending && (
        <ActivateDialog
          strategy={pending}
          markets={markets}
          vault={vault}
          wallet={wallet}
          onClose={() => setPending(null)}
          onDone={(s) => { if (s.id) dropDraft(s.id); setTab("active"); }}
        />
      )}
    </section>
  );
}

function Empty({ children }) {
  return <p className="py-8 text-center text-[11px] leading-[1.7] text-[#8d8792]">{children}</p>;
}
