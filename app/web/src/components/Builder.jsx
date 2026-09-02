import { useEffect, useMemo, useState } from "react";
import { simulate, branchPreview, resolutionsFromMarkets, fmt, KIND_LABEL } from "../sim.js";
import {
  ORDER_TYPES, makeStep, seedFromMarkets, loadStrategy, saveStrategy,
  validate, notices, notionalOf, toVaultStep, onchainStepId,
} from "../strategy.js";
import { armStep } from "../chain/vault.js";
import { marketLabel } from "../chain/markets.js";
import { txUrl, addressUrl } from "../chain/config.js";
import { ORDER_TYPE_COPY, money } from "../lib/language.js";
import { upsertDraft } from "../lib/store.js";

export default function Builder({ markets, vault, wallet, onWallet, initialDraft = null, advanced = false, onClose = null }) {
  const [strategy, setStrategy] = useState(() => initialDraft || loadStrategy());
  const [showRaw, setShowRaw] = useState(false);
  const [selected, setSelected] = useState(null);
  const [ran, setRan] = useState(null);
  const [arming, setArming] = useState(null);
  const [armResult, setArmResult] = useState(null);

  // Seed once from real open markets if nothing is stored yet.
  useEffect(() => {
    if (strategy || markets.status !== "ready" || markets.open.length < 2) return;
    setStrategy(seedFromMarkets(markets.open));
  }, [strategy, markets.status, markets.open]);

  useEffect(() => { if (initialDraft) setStrategy(initialDraft); }, [initialDraft]);
  useEffect(() => {
    if (!strategy) return;
    saveStrategy(strategy);
    if (strategy.id) upsertDraft(strategy);
  }, [strategy]);
  useEffect(() => {
    if (!strategy?.steps.length) return;
    if (!strategy.steps.some((s) => s.key === selected)) setSelected(strategy.steps[0].key);
  }, [strategy, selected]);

  const errors = useMemo(() => (strategy ? validate(strategy) : []), [strategy]);
  const warnings = useMemo(() => (strategy ? notices(strategy) : []), [strategy]);
  const errorsFor = (key) => errors.filter((e) => e.scope === key);
  const steps = strategy?.steps ?? [];
  const selectedStep = steps.find((s) => s.key === selected);

  const committed = ran?.committed ?? steps.reduce((sum, s) => sum + notionalOf(s), 0n);
  const exposure = strategy && strategy.maxOutstanding > 0n
    ? Math.min(100, (Number(committed) / Number(strategy.maxOutstanding)) * 100)
    : 0;

  const patch = (change) => setStrategy((cur) => ({ ...cur, ...change }));
  const update = (key, change) => {
    setStrategy((cur) => ({ ...cur, steps: cur.steps.map((s) => (s.key === key ? { ...s, ...change } : s)) }));
    setRan(null);
  };
  const setTrigger = (key, marketId) => {
    const m = markets.open.find((x) => x.marketId === marketId) || markets.resolved.find((x) => x.marketId === marketId);
    update(key, { triggerMarketId: marketId, triggerLabel: m?.question || "", triggerExpiry: m?.expiry || null });
  };
  const setSuccessor = (key, marketId) => {
    const m = markets.open.find((x) => x.marketId === marketId);
    update(key, { successorMarketId: marketId, successorLabel: m?.question || "", successorExpiry: m?.expiry || null, pool: m?.pool || "" });
  };
  const addStep = () => {
    const index = steps.length + 1;
    const next = makeStep(index, { triggerMarket: markets.open[index - 1], successorMarket: markets.open[index] });
    setStrategy((cur) => ({ ...cur, steps: [...cur.steps, next] }));
    setSelected(next.key);
    setRan(null);
  };
  const removeStep = (key) => {
    setStrategy((cur) => ({ ...cur, steps: cur.steps.filter((s) => s.key !== key) }));
    setRan(null);
  };

  // Replays the plan against genuine settled DreamDEX markets pulled from the
  // Somnia indexer, using the vault's own winner, branch and cap rules.
  const runSimulation = () => {
    const history = resolutionsFromMarkets(markets.resolved).map((r) => ({ ...r, source: "settled" }));
    const covered = new Set(history.map((r) => r.marketId.toLowerCase()));
    // Steps watching a market that has not settled yet still get a projected
    // pass so the preview shows what the plan does when it does settle.
    const projected = steps
      .filter((s) => s.triggerMarketId && !covered.has(s.triggerMarketId.toLowerCase()))
      .map((s) => ({
        marketId: s.triggerMarketId, questionId: "projected",
        payoutNumerators: [10000000n, 0n], voided: false, source: "projected",
      }));
    setRan(simulate(strategy, [...history, ...projected]));
    setArmResult(null);
  };
  const eventFor = (key) => ran?.events.find((e) => e.stepKey === key);

  const owner = vault.state?.owner;
  const isOwner = vault.isOwner(wallet.account);
  const canArm = (step) =>
    wallet.connected && wallet.onShannon && isOwner && !vault.state?.paused &&
    errors.length === 0 && Boolean(step?.pool && step?.triggerMarketId);

  const armReason = (step) => {
    if (!wallet.connected) return "Connect a wallet to put this live.";
    if (!wallet.onShannon) return "Switch your wallet to the Somnia network.";
    if (!vault.state) return "Reading your account from the network.";
    if (!isOwner) return "This wallet does not control the trading account.";
    if (vault.state.paused) return "Trading is paused. Resume it first.";
    if (errors.length) return errors[0].message;
    if (!step?.pool || !step?.triggerMarketId) return "Pick both markets first.";
    return "";
  };

  const doArm = async (step) => {
    setArmResult(null);
    setArming(step.key);
    try {
      const stepId = onchainStepId(strategy, step);
      const result = await armStep({
        provider: wallet.provider, account: wallet.account, stepId, step: toVaultStep(step),
      });
      vault.track({
        stepId, key: step.key, name: step.name, strategy: strategy.name,
        triggerLabel: step.triggerLabel, successorLabel: step.successorLabel,
        triggerMarketId: step.triggerMarketId, pool: step.pool,
        blockNumber: result.blockNumber.toString(), txHash: result.hash, armedAt: Date.now(),
      });
      setArmResult({ ok: result.status === "success", hash: result.hash, key: step.key });
    } catch (cause) {
      setArmResult({ ok: false, key: step.key, error: cause?.shortMessage || cause?.message || "The transaction was not sent." });
    } finally {
      setArming(null);
    }
  };

  if (!strategy) {
    return (
      <section id="build" className="product-band">
        <div className="mx-auto max-w-[1280px] px-7 py-24 sm:px-12 lg:px-16 lg:py-32">
          <span className="section-tag bg-[#52d8ed]">Builder</span>
          <h2 className="mt-5 max-w-[520px] text-[42px] font-extrabold leading-[1.03] tracking-[-0.055em] text-[#0b0a0e] sm:text-[54px]">Set the rules.<br />See the risk.</h2>
          <div className="workspace-card mt-16 p-10 text-[12px] text-[#77717d]">
            {markets.status === "error"
              ? <>Could not reach the Somnia markets indexer. <button onClick={markets.reload} className="font-bold text-[#6f58c2]">Retry</button></>
              : "Loading live DreamDEX markets from Somnia…"}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="build" className="product-band">
      <div className="mx-auto max-w-[1280px] px-7 py-24 sm:px-12 lg:px-16 lg:py-32">
        <div className="grid items-end gap-10 lg:grid-cols-[.8fr_1.2fr]">
          <div>
            <span className="section-tag bg-[#52d8ed]">{advanced ? "Advanced builder" : "Try it"}</span>
            <h2 className="mt-5 max-w-[520px] text-[42px] font-extrabold leading-[1.03] tracking-[-0.055em] text-[#0b0a0e] sm:text-[54px]">Set the rules.<br />See the risk.</h2>
          </div>
          <div className="max-w-[520px] lg:justify-self-end">
            <p className="text-[14px] leading-[1.75] text-[#65616b]">Set each follow-on trade by hand. Every number here is the same one your account checks before it risks anything.</p>
            <div className="mt-5 flex flex-wrap items-center gap-7 text-[10px] font-semibold uppercase tracking-[.13em] text-[#98939d]">
              <span>Live markets</span><span>Test it first</span><span>Limits enforced</span>
              {onClose && <button onClick={onClose} className="normal-case tracking-normal text-[10px] font-semibold text-[#8f8994] transition hover:text-[#242128]">Back to your desk</button>}
            </div>
          </div>
        </div>

        <div className="workspace-card mt-16">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#ece9ef] px-6 py-4 lg:px-8">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-[#8b72e8] shadow-[0_0_0_5px_rgba(139,114,232,.12)]" />
              <input aria-label="Sequence name" value={strategy.name} onChange={(e) => patch({ name: e.target.value })} className="w-[190px] bg-transparent text-[13px] font-bold tracking-[-.02em] text-[#242128] outline-none" />
              <span className="text-[10px] text-[#aaa5ae]">Saved locally</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden text-[10px] text-[#928d97] sm:block">{markets.status === "ready" ? `${markets.open.length} live markets` : markets.status === "error" ? "Indexer unreachable" : "Loading markets…"}</span>
              <button disabled={errors.length > 0} onClick={runSimulation} className="soft-button bg-[#111014] text-white disabled:opacity-35">Preview sequence</button>
            </div>
          </div>

          <div className="grid lg:grid-cols-[300px_1fr]">
            <aside className="border-b border-[#ece9ef] bg-[#fbfbfc] p-6 lg:border-b-0 lg:border-r lg:p-8">
              <div className="mb-6 flex items-center justify-between">
                <div><div className="micro-label">Sequence path</div><div className="mt-1 text-[11px] text-[#99949e]">{steps.length} bounded actions</div></div>
                <button aria-label="Add successor step" onClick={addStep} className="grid h-8 w-8 place-items-center rounded-full border border-[#dfdbe3] bg-white text-lg font-light text-[#514c57] transition hover:border-[#8b72e8]">+</button>
              </div>
              <div className="relative">
                <div className="absolute bottom-7 left-[11px] top-7 w-px bg-[#ded9e3]" />
                {steps.map((step, index) => {
                  const event = eventFor(step.key);
                  const bad = errorsFor(step.key).length > 0;
                  return (
                    <button key={step.key} onClick={() => setSelected(step.key)} className={`sequence-step group relative mb-3 text-left ${selected === step.key ? "is-selected" : ""}`}>
                      <span className={`absolute -left-[26px] top-5 grid h-[22px] w-[22px] place-items-center rounded-full border bg-white text-[9px] font-bold ${event?.action === "EXECUTED" ? "border-[#55b58a] text-[#42946f]" : event ? "border-[#d1ccd5] text-[#aaa5ae]" : bad ? "border-[#e9b4a6] text-[#d1795f]" : "border-[#8b72e8] text-[#7056c9]"}`}>{index + 1}</span>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-[12px] font-bold text-[#252229]">{step.triggerMarketId ? stepHeadline(step) : "Pick a market"}</div>
                          <div className="mt-2 text-[10px] text-[#817c86]">Outcome 0 → <b className="font-semibold text-[#38343d]">{step.buyYesOnWin0 ? "Buy YES" : "Buy NO"}</b></div>
                        </div>
                        <span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${event?.action === "EXECUTED" ? "bg-[#55b58a]" : event ? "bg-[#c7c2ca]" : bad ? "bg-[#e28e75]" : "bg-[#8b72e8]"}`} />
                      </div>
                      <div className="mt-4 flex justify-between border-t border-[#efecf1] pt-3 font-mono text-[9px] text-[#99949d]"><span>{fmt(notionalOf(step))}</span><span>cap {fmt(step.notionalCap)}</span></div>
                    </button>
                  );
                })}
              </div>
              <button onClick={addStep} className="mt-2 w-full rounded-sm border border-dashed border-[#d9d4de] px-4 py-3 text-[10px] font-semibold text-[#746e79] transition hover:border-[#8b72e8] hover:text-[#5e46bb]">+ Add successor</button>
            </aside>

            <div className="p-6 lg:p-8 xl:p-10">
              <div className="grid gap-8 xl:grid-cols-[1fr_260px]">
                {selectedStep && (
                  <div>
                    <div className="flex items-start justify-between gap-6">
                      <div>
                        <div className="micro-label">Edit step {steps.findIndex((s) => s.key === selectedStep.key) + 1}</div>
                        <h3 className="mt-2 text-[25px] font-extrabold tracking-[-.04em] text-[#151318]">Define the next action</h3>
                      </div>
                      {steps.length > 1 && <button onClick={() => removeStep(selectedStep.key)} className="text-[10px] font-semibold text-[#aaa4ae] transition hover:text-[#ee7d66]">Remove</button>}
                    </div>

                    <div className="mt-8 grid gap-x-5 gap-y-6 sm:grid-cols-2">
                      <Field label="Watch this market settle">
                        <select className="product-input" value={selectedStep.triggerMarketId} onChange={(e) => setTrigger(selectedStep.key, e.target.value)}>
                          <option value="">Select a live market…</option>
                          {markets.open.map((m) => <option key={m.marketId} value={m.marketId}>{marketLabel(m)} · {m.question}</option>)}
                          {selectedStep.triggerMarketId && !markets.open.some((m) => m.marketId === selectedStep.triggerMarketId) &&
                            <option value={selectedStep.triggerMarketId}>{selectedStep.triggerLabel || "Previously selected market"}</option>}
                        </select>
                      </Field>
                      <Field label="Then trade this market">
                        <select className="product-input" value={selectedStep.successorMarketId} onChange={(e) => setSuccessor(selectedStep.key, e.target.value)}>
                          <option value="">Select a successor market…</option>
                          {markets.open.map((m) => <option key={m.marketId} value={m.marketId}>{marketLabel(m)} · {m.question}</option>)}
                          {selectedStep.successorMarketId && !markets.open.some((m) => m.marketId === selectedStep.successorMarketId) &&
                            <option value={selectedStep.successorMarketId}>{selectedStep.successorLabel || "Previously selected market"}</option>}
                        </select>
                      </Field>
                      <Field label="Price per contract"><div className="input-prefix"><span>$</span><input type="number" step="0.01" value={Number(selectedStep.price) / 1e6} onChange={(e) => update(selectedStep.key, { price: BigInt(Math.max(0, Math.round(Number(e.target.value) * 1e6))) })} /></div></Field>
                      <Field label="How many contracts"><div className="input-prefix"><input type="number" value={Number(selectedStep.quantity)} onChange={(e) => update(selectedStep.key, { quantity: BigInt(Math.max(0, Math.round(Number(e.target.value)))) })} /><span>contracts</span></div></Field>
                      <Field label="Most to risk here"><div className="input-prefix"><span>$</span><input type="number" step="0.01" value={Number(selectedStep.notionalCap) / 1e6} onChange={(e) => update(selectedStep.key, { notionalCap: BigInt(Math.max(0, Math.round(Number(e.target.value) * 1e6))) })} /></div></Field>
                      <Field label="If it lands YES">
                        <select className="product-input" value={selectedStep.buyYesOnWin0 ? "yes" : "no"} onChange={(e) => update(selectedStep.key, { buyYesOnWin0: e.target.value === "yes" })}>
                          <option value="yes">Buy YES</option><option value="no">Buy NO</option>
                        </select>
                      </Field>
                      <Field label="How to fill it">
                        <select className="product-input" value={selectedStep.orderType} onChange={(e) => update(selectedStep.key, { orderType: Number(e.target.value) })}>
                          {ORDER_TYPES.map((t) => <option key={t.value} value={t.value}>{ORDER_TYPE_COPY[t.value]?.label || t.label}</option>)}
                        </select>
                      </Field>
                      <Field label="Trade goes to">
                        <div className="product-input truncate text-[12px] text-[#77717d]">{selectedStep.successorLabel ? "The market you picked above" : "Pick a market above"}</div>
                      </Field>
                    </div>

                    <div className="mt-6">
                      <button onClick={() => setShowRaw((v) => !v)} className="details-toggle">
                        {showRaw ? "Hide onchain details" : "Onchain details"}
                      </button>
                      {showRaw && (
                        <dl className="mt-4 space-y-2.5 rounded-sm border border-[#ece9ef] bg-[#fbfbfc] p-5 font-mono text-[9px] leading-[1.6] text-[#77717d]">
                          <RawRow label="Trigger market id" value={selectedStep.triggerMarketId} />
                          <RawRow label="Successor market id" value={selectedStep.successorMarketId} />
                          <RawRow label="Binary pool" value={selectedStep.pool} href={selectedStep.pool ? addressUrl(selectedStep.pool) : null} />
                          <RawRow label="Order price (raw, 6dp)" value={selectedStep.price.toString()} />
                          <RawRow label="Quantity" value={selectedStep.quantity.toString()} />
                          <RawRow label="Notional cap (raw)" value={selectedStep.notionalCap.toString()} />
                          <RawRow label="Order type" value={`${selectedStep.orderType} · ${ORDER_TYPE_COPY[selectedStep.orderType]?.label}`} />
                        </dl>
                      )}
                    </div>

                    <div className="mt-8 rounded-sm border border-[#ece9ef] bg-[#fbfbfc] p-5">
                      <div className="micro-label">What each outcome does</div>
                      <div className="mt-4 space-y-2.5">
                        {branchPreview(strategy, selectedStep).map((row) => (
                          <div key={row.win} className="flex items-center justify-between text-[10px]">
                            <span className="text-[#827d87]">{row.win === 255 ? "Market voided" : `Outcome ${row.win} wins`}</span>
                            <span className={`font-semibold ${row.action === "EXECUTED" ? "text-[#40906b]" : "text-[#8d8792]"}`}>
                              {row.action === "EXECUTED" ? `${KIND_LABEL[row.kind]} · ${fmt(row.notional)}` : `Skip · ${row.reason}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-8 rounded-sm border border-[#ece9ef] p-5">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <div className="micro-label">Put this step live</div>
                          <p className="mt-2 max-w-[360px] text-[10px] leading-[1.65] text-[#77717d]">
                            You approve this in your wallet. From then on it runs on its own, and your account will not let it risk more than the limits you set.
                          </p>
                        </div>
                        {canArm(selectedStep)
                          ? <button onClick={() => doArm(selectedStep)} disabled={arming === selectedStep.key} className="soft-button bg-[#111014] text-white disabled:opacity-50">{arming === selectedStep.key ? "Approve in your wallet…" : "Put it live"}</button>
                          : <button onClick={wallet.connected ? undefined : onWallet} disabled={wallet.connected} className="soft-button border border-[#dcd7e1] bg-white text-[#252229] disabled:opacity-45">{wallet.connected ? "Not ready yet" : "Connect wallet"}</button>}
                      </div>
                      {!canArm(selectedStep) && <p className="mt-3 text-[10px] font-semibold text-[#a8a2ad]">{armReason(selectedStep)}</p>}
                      {armResult?.key === selectedStep.key && (
                        armResult.ok
                          ? <p className="mt-3 text-[10px] font-semibold text-[#40906b]">This step is live. <a className="text-[#6f58c2]" href={txUrl(armResult.hash)} target="_blank" rel="noreferrer">Receipt ↗</a></p>
                          : <p className="mt-3 text-[10px] font-semibold text-[#dc6e58]" role="alert">{armResult.error || "The transaction did not succeed."}</p>
                      )}
                    </div>
                  </div>
                )}

                <aside className="risk-card">
                  <div className="flex items-center justify-between">
                    <span className="micro-label">Risk preview</span>
                    <span className={`rounded-full px-2 py-1 text-[8px] font-bold uppercase tracking-[.1em] ${errors.length ? "bg-[#fff0ec] text-[#e27259]" : warnings.length ? "bg-[#fff8f0] text-[#b8823f]" : "bg-[#eaf7f0] text-[#40906b]"}`}>{errors.length ? "Review" : warnings.length ? "Cap will bind" : "Within caps"}</span>
                  </div>
                  <div className="mt-7">
                    <div className="text-[9px] uppercase tracking-[.12em] text-[#a39ea7]">Planned exposure</div>
                    <div className="mt-1 text-[30px] font-extrabold tracking-[-.05em] text-[#161419]">{fmt(committed)}</div>
                    <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[#ebe8ee]"><div className="h-full rounded-full bg-[#8b72e8] transition-all" style={{ width: `${exposure}%` }} /></div>
                    <div className="mt-2 flex justify-between font-mono text-[8px] text-[#aaa5ae]"><span>committed</span><span>{fmt(strategy.maxOutstanding)} cap</span></div>
                  </div>
                  <div className="mt-7 space-y-4 border-t border-[#e7e3ea] pt-5">
                    <RiskRow label="Funds available" value={<input aria-label="Bankroll" className="w-[62px] bg-transparent text-right font-mono outline-none" type="number" step="0.01" value={Number(strategy.bankroll) / 1e6} onChange={(e) => patch({ bankroll: BigInt(Math.max(0, Math.round(Number(e.target.value) * 1e6))) })} />} />
                    <RiskRow label="Your total limit" value={<input aria-label="Vault cap" className="w-[62px] bg-transparent text-right font-mono outline-none" type="number" step="0.01" value={Number(strategy.maxOutstanding) / 1e6} onChange={(e) => patch({ maxOutstanding: BigInt(Math.max(0, Math.round(Number(e.target.value) * 1e6))) })} />} />
                    <RiskRow label="Limit checks" value={errors.length ? `${errors.length} issue${errors.length > 1 ? "s" : ""}` : warnings.length ? "Cap will bind" : "Passing"} good={!errors.length && !warnings.length} />
                    <RiskRow label="Limit on your account" value={vault.state ? fmt(vault.state.maxOutstanding) : "reading…"} />
                  </div>
                  {errors.length > 0 && (
                    <ul className="mt-5 space-y-2 border-t border-[#e7e3ea] pt-5 text-[9px] leading-[1.5] text-[#c47b64]">
                      {errors.slice(0, 4).map((e, i) => <li key={i}>{e.message}</li>)}
                    </ul>
                  )}
                  {errors.length === 0 && warnings.length > 0 && (
                    <ul className="mt-5 space-y-2 border-t border-[#e7e3ea] pt-5 text-[9px] leading-[1.5] text-[#a8834f]">
                      {warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  )}
                </aside>
              </div>

              <div className={`simulation-strip mt-10 ${ran ? "has-result" : ""}`}>
                <div>
                  <div className="micro-label">Simulation</div>
                  <p className="mt-2 max-w-[520px] text-[11px] leading-[1.65] text-[#77717d]">
                    Runs your rules against markets that have already settled, using exactly the logic your account uses when it trades for real. Nothing moves and nothing is risked.
                  </p>
                </div>
                {errors.length > 0
                  ? <div className="text-[10px] font-semibold text-[#dc6e58]">{errors[0].message}</div>
                  : ran
                    ? <div className="flex flex-wrap items-center gap-5">
                        {ran.events.length === 0 && <span className="text-[10px] text-[#8d8792]">No settled market in the recent window matches these steps yet.</span>}
                        {ran.events.map((event, i) => (
                          <span key={`${event.stepKey}-${i}`} className="flex items-center gap-2 text-[10px] text-[#68636d]">
                            <i className={`h-1.5 w-1.5 rounded-full ${event.action === "EXECUTED" ? "bg-[#55b58a]" : "bg-[#c7c2ca]"}`} />
                            {event.action === "EXECUTED" ? `${KIND_LABEL[event.kind]} · ${fmt(event.notional)}` : `Skipped · ${event.reason}`}
                            <b className="text-[8px] font-bold uppercase tracking-[.1em] text-[#aaa5ae]">{event.source === "settled" ? "settled" : "projected"}</b>
                          </span>
                        ))}
                        <button onClick={runSimulation} className="soft-button border border-[#dcd7e1] bg-white text-[#252229]">Run again</button>
                      </div>
                    : <button onClick={runSimulation} className="soft-button bg-[#111014] text-white">Run preview</button>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function stepHeadline(step) {
  const when = step.triggerExpiry ? new Date(step.triggerExpiry * 1000).toUTCString().slice(17, 22) : "";
  const asset = /BTC/i.test(step.triggerLabel) ? "BTC" : /ETH/i.test(step.triggerLabel) ? "ETH" : "Market";
  return when ? `${asset} · ${when} UTC` : asset;
}

function RawRow({ label, value, href }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 not-italic">{label}</dt>
      <dd className="truncate text-right text-[#4f4a56]">
        {href ? <a href={href} target="_blank" rel="noreferrer" className="hover:text-[#6f58c2]">{value} ↗</a> : (value || "—")}
      </dd>
    </div>
  );
}

function Field({ label, children }) { return <label className="block"><span className="mb-2 block text-[9px] font-bold uppercase tracking-[.12em] text-[#9d98a2]">{label}</span>{children}</label>; }
function RiskRow({ label, value, good }) { return <div className="flex items-center justify-between text-[10px]"><span className="text-[#8d8792]">{label}</span><span className={`font-semibold ${good ? "text-[#40906b]" : "text-[#312d35]"}`}>{value}</span></div>; }
