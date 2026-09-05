import { useEffect, useMemo, useState } from "react";
import MarketContext from "./MarketContext.jsx";
import ScreenHeader from "./ScreenHeader.jsx";
import LimitDialog from "./LimitDialog.jsx";
import { statusCopy, bucketFor, money, countdown, marketName } from "../lib/language.js";
import { explainEvent } from "../lib/command.js";
import { loadDrafts, removeDraft } from "../lib/store.js";
import { cancelStep, syncResolution, redeemPosition } from "../chain/vault.js";
import { findClaimablePositions } from "../chain/positions.js";
import { useTx } from "../hooks/useTx.js";
import GoLive from "./GoLive.jsx";
import TxState from "./TxState.jsx";
import { readMarketOnchain } from "../chain/module.js";

const TABS = [
  { key: "active", label: "Live" },
  { key: "draft", label: "Drafts" },
  { key: "completed", label: "Finished" },
];

// Your sequences: the connected home. It answers what is running, what it is
// waiting for, what it has done and how much is at risk. It does not create
// sequences; that is Build's job, and this screen only points at it.
export default function Dashboard({ markets, vault, wallet, onNewSequence, onEditDraft, onOpenDetails }) {
  const [tab, setTab] = useState("active");
  const [drafts, setDrafts] = useState(() => loadDrafts(wallet.account));
  const [limitOpen, setLimitOpen] = useState(false);
  const [acting, setActing] = useState(null);
  const tx = useTx();
  const busy = tx.busy ? acting : null;
  const [, tick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { setDrafts(loadDrafts(wallet.account)); }, [wallet.account]);

  const state = vault.state;
  const onchain = vault.steps.filter((s) => s.exists);
  const active = onchain.filter((s) => bucketFor(s.statusLabel) === "active");
  const completed = onchain.filter((s) => bucketFor(s.statusLabel) === "completed");
  const counts = { active: active.length, draft: drafts.length, completed: completed.length };

  // Open on whichever list actually has something in it.
  useEffect(() => {
    if (counts.active === 0 && tab === "active") {
      setTab(counts.draft ? "draft" : counts.completed ? "completed" : "active");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.status]);

  const headroom = state ? state.maxOutstanding - state.outstanding : null;
  const usage = state && state.maxOutstanding > 0n
    ? Math.min(100, (Number(state.outstanding) / Number(state.maxOutstanding)) * 100) : 0;

  const recent = useMemo(
    () => vault.events.filter((e) => ["Executed", "Skipped", "Triggered"].includes(e.name)).slice(-4).reverse(),
    [vault.events],
  );

  // A market can settle without the event reaching the account. Rather than
  // leave a sequence waiting for ever, offer to read the result from the market
  // itself. Anyone may do this; it takes nothing on trust.
  const [resolvable, setResolvable] = useState({});
  useEffect(() => {
    let live = true;
    (async () => {
      const next = {};
      for (const s of active) {
        const market = markets.open.find((m) => m.marketId?.toLowerCase() === s.triggerMarketId?.toLowerCase());
        const expired = market?.expiry ? market.expiry * 1000 < Date.now() : true;
        if (!expired) continue;
        try {
          const onchain = await readMarketOnchain(s.triggerMarketId);
          if (onchain.exists) next[s.stepId] = true;
        } catch { /* leave it out */ }
      }
      if (live) setResolvable(next);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.status, active.length]);

  // Won positions are outcome tokens, not cash. Until they are redeemed the
  // bankroll is locked up in something that has already finished, so a rolling
  // strategy quietly starves. Reads go through the markets SDK.
  const [claimable, setClaimable] = useState([]);
  useEffect(() => {
    let live = true;
    if (!vault.address) { setClaimable([]); return undefined; }
    findClaimablePositions(vault.address)
      .then((found) => { if (live) setClaimable(found); })
      .catch(() => { if (live) setClaimable([]); });
    return () => { live = false; };
  }, [vault.address, vault.status, completed.length]);

  // Every one of these opens a wallet, and every one of them used to swallow
  // whatever came back. Cancelling a signature produced no message, no change
  // and no way to tell the click had registered at all.
  const claim = async (position) => {
    setActing(position.marketId);
    const r = await tx.run({
      send: (onHash) => redeemPosition({
        provider: wallet.provider, account: wallet.account,
        vault: vault.address, marketId: position.marketId, onHash,
      }),
    });
    if (r.ok) {
      setClaimable(await findClaimablePositions(vault.address).catch(() => claimable));
      await vault.refresh();
    }
  };

  const checkResult = async (step) => {
    setActing(step.stepId);
    const r = await tx.run({
      send: (onHash) => syncResolution({
        provider: wallet.provider, account: wallet.account,
        vault: vault.address, marketId: step.triggerMarketId, onHash,
      }),
    });
    if (r.ok) await vault.refresh();
  };

  const stopSequence = async (step) => {
    setActing(step.stepId);
    const r = await tx.run({
      send: (onHash) => cancelStep({
        provider: wallet.provider, account: wallet.account,
        vault: vault.address, stepId: step.stepId, onHash,
      }),
    });
    if (r.ok) await vault.refresh();
  };

  // Funds are what a sequence actually needs. Listening for results on its own
  // is an upgrade, so it is never what this banner leads with — saying "nothing
  // will run" about an optional step sends people at a 32 STT stake they do not
  // need and probably cannot reach.
  const needsFunds = !(state?.bankroll > 0n);
  const setupDone = !needsFunds;

  return (
    <section id="dashboard" className="dashboard-shell">
      <div className="mx-auto max-w-[1280px] px-7 py-14 sm:px-12 lg:px-16 lg:py-16">
        <ScreenHeader
          trail={[{ label: "Your sequences" }]}
          tag="Your sequences"
          title={counts.active > 0 ? "Running without you." : "Nothing running yet."}
          blurb={counts.active > 0
            ? "Each of these is waiting on its market. When one settles, your follow-on trade goes in automatically."
            : "When you activate a sequence it appears here, with what it is waiting for and what it will do."}
          actions={<button onClick={onNewSequence} className="soft-button bg-[#111014] px-6 py-3 text-white">New sequence</button>}
        />

        {state && (
          <div className="mt-10 risk-summary">
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
            <div className="hidden h-1 flex-1 overflow-hidden rounded-full bg-[#ebe8ee] sm:block">
              <div className="h-full rounded-full bg-[#8b72e8] transition-all" style={{ width: `${usage}%` }} />
            </div>
          </div>
        )}

        {/* Funding is required, so it belongs on the screen people actually live
            on. It used to exist only behind "Onchain details", which meant the
            one mandatory step was reached through a page of event signatures. */}
        {!setupDone && <GoLive vault={vault} wallet={wallet} />}

        {state?.paused && (
          <div className="setup-banner mt-6">
            <div>
              <div className="text-[12px] font-bold text-[#242128]">Trading is paused</div>
              <p className="mt-1.5 text-[10px] leading-[1.6] text-[#8a5f47]">Nothing will run until you resume it.</p>
            </div>
            <button onClick={onOpenDetails} className="soft-button bg-[#111014] text-white">Manage</button>
          </div>
        )}

        <div className="mt-8">
          <div className="micro-label mb-4">Markets right now</div>
          <MarketContext markets={markets} />
        </div>

        <div className="sequence-panel mt-10">
          <div className="flex gap-6 border-b border-[#e5e1e8] px-6 pt-5">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)} className={`state-tab ${tab === t.key ? "is-active" : ""}`}>
                {t.label}{counts[t.key] > 0 && <span className="ml-1.5 text-[9px] text-[#a19ca5]">{counts[t.key]}</span>}
              </button>
            ))}
          </div>

          <div className="p-6">
            {tab === "active" && (
              active.length === 0
                ? <Empty action={onNewSequence} label="Build one">Nothing is live. Anything you activate shows here with what it is waiting for.</Empty>
                : <div className="space-y-3">
                    {active.map((s) => {
                      const market = markets.open.find((m) => m.marketId?.toLowerCase() === s.triggerMarketId?.toLowerCase());
                      const copy = statusCopy(s.statusLabel);
                      return (
                        <div key={s.stepId} className="sequence-row is-live">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="h-1.5 w-1.5 rounded-full bg-[#55b58a]" />
                              <span className="text-[12px] font-bold text-[#252229]">{market ? marketName(market) : (s.triggerLabel || "Waiting on a market")}</span>
                            </div>
                            <div className="mt-1.5 text-[10px] leading-[1.55] text-[#817c86]">
                              {copy.blurb} {market?.expiry ? `Settles ${countdown(market.expiry)}.` : ""}
                            </div>
                            <div className="mt-1.5 text-[10px] text-[#a19ca5]">
                              If YES → {sideLabel(s.actionOnWin0)} · If NO → {sideLabel(s.actionOnWin1)} · up to {money(s.notionalCap)}
                            </div>
                            {resolvable[s.stepId] && (
                              <div className="mt-2 text-[10px] leading-[1.55] text-[#a8813f]">
                                This market has settled but the result has not reached your account yet. Check it to move the sequence on.
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-4">
                            {/* The market has settled but the result has not
                                reached the account. This is the way out of a
                                sequence that would otherwise wait for ever, and
                                anyone can press it. */}
                            {resolvable[s.stepId] && (
                              <button
                                disabled={busy === s.stepId}
                                onClick={() => checkResult(s)}
                                className="soft-button bg-[#111014] px-4 py-2 text-white disabled:opacity-40"
                              >
                                {busy === s.stepId ? "Checking…" : "Check result"}
                              </button>
                            )}
                            <button disabled={busy === s.stepId} onClick={() => stopSequence(s)} className="text-[10px] font-semibold text-[#8f8994] hover:text-[#dc6e58] disabled:opacity-40">
                              {busy === s.stepId ? "Stopping…" : "Stop"}
                            </button>
                          </div>
                          {acting === s.stepId && <TxState tx={tx} labels={{ success: "Done." }} className="basis-full" />}
                        </div>
                      );
                    })}
                  </div>
            )}

            {tab === "draft" && (
              drafts.length === 0
                ? <Empty action={onNewSequence} label="Build one">No drafts saved. A sequence you start but do not activate waits here.</Empty>
                : <div className="space-y-3">
                    {drafts.map((d) => (
                      <div key={d.id} className="sequence-row">
                        <div>
                          <div className="text-[12px] font-bold text-[#252229]">{d.name}</div>
                          <div className="mt-1.5 text-[10px] text-[#817c86]">
                            {d.steps.length} trade{d.steps.length > 1 ? "s" : ""} · risks up to {money(d.maxOutstanding)}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <button onClick={() => onEditDraft(d)} className="soft-button bg-[#111014] text-white">Open</button>
                          <button onClick={() => setDrafts(removeDraft(wallet.account, d.id))} className="text-[10px] font-semibold text-[#aaa4ae] hover:text-[#dc6e58]">Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
            )}

            {tab === "completed" && claimable.length > 0 && (
              <div className="mb-5 space-y-3">
                <div className="micro-label">Money still tied up</div>
                {claimable.map((p) => (
                  <div key={p.marketId} className="sequence-row">
                    <div>
                      <div className="text-[12px] font-bold text-[#252229]">
                        {p.question || marketName(p) || "Settled market"}
                      </div>
                      <div className="mt-1.5 text-[10px] text-[#817c86]">
                        {p.worthless
                          ? `This side did not win. Nothing to collect.`
                          : p.voided
                            ? `Market was voided. ${money(p.claimable)} comes back.`
                            : `You were right. ${money(p.claimable)} is waiting to be collected.`}
                      </div>
                    </div>
                    {p.worthless
                      ? <span className="status-pill neutral">Closed</span>
                      : <button
                          onClick={() => claim(p)}
                          disabled={busy === p.marketId}
                          className="soft-button bg-[#111014] px-4 py-2 text-white disabled:opacity-50">
                          {busy === p.marketId ? "Collecting…" : "Collect"}
                        </button>}
                    {acting === p.marketId && <TxState tx={tx} labels={{ success: "Collected. The funds are back in your account." }} className="basis-full" />}
                  </div>
                ))}
              </div>
            )}

            {tab === "completed" && (
              completed.length === 0
                ? (claimable.length > 0 ? null : <Empty>Nothing has finished yet. Once a market settles, the result lands here.</Empty>)
                : <div className="space-y-3">
                    {completed.map((s) => {
                      const copy = statusCopy(s.statusLabel);
                      return (
                        <div key={s.stepId} className="sequence-row">
                          <div>
                            <div className="text-[12px] font-bold text-[#252229]">{s.strategy || "Sequence"}</div>
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
            </div>
          )}
        </div>

        <div className="mt-8 text-center">
          <button onClick={onOpenDetails} className="details-toggle">Onchain details and receipts →</button>
        </div>
      </div>

      {limitOpen && <LimitDialog vault={vault} wallet={wallet} onClose={() => setLimitOpen(false)} />}
    </section>
  );
}

const sideLabel = (a) => (a === 255 ? "stop" : a === 2 ? "buy NO" : "buy YES");

function Empty({ children, action, label }) {
  return (
    <div className="py-10 text-center">
      <p className="text-[11px] leading-[1.7] text-[#8d8792]">{children}</p>
      {action && <button onClick={action} className="soft-button mt-5 bg-[#111014] px-5 py-2.5 text-white">{label}</button>}
    </div>
  );
}
