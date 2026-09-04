import { useEffect, useMemo, useState } from "react";
import { fmt } from "../sim.js";
import {
  ORDER_TYPES, ACTION, ACTION_CHOICES, makeStep, seedFromMarkets, loadStrategy, saveStrategy,
  validate, notices, notionalOf, toVaultStep, onchainStepId, nextWindowFor,
} from "../strategy.js";
import { armStep, queueStep, ensurePoolAllowances } from "../chain/vault.js";
import { txUrl, addressUrl } from "../chain/config.js";
import { upsertDraft, newDraftId } from "../lib/store.js";
import ScreenHeader from "./ScreenHeader.jsx";
import CommandBar from "./CommandBar.jsx";
import {
  marketName, marketQuestion, branchActions, describePlan,
  countdown, settlePhrase, marketShortAsk, asOdds, ORDER_TYPE_COPY,
} from "../lib/language.js";

// The builder, arranged as the questions a trader actually asks:
//   what am I watching, what happens if it goes up, what if it goes down,
//   how much can I lose, and what exactly happens after I activate.
// Contract vocabulary lives only under "Onchain details".
export default function Builder({ markets, vault, wallet, initialDraft = null, onWallet, onExit, onActivated }) {
  const [strategy, setStrategy] = useState(() => initialDraft || loadStrategy());
  const [selected, setSelected] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const [arming, setArming] = useState(false);
  const [armResult, setArmResult] = useState(null);
  const [book, setBook] = useState(null);
  const [tradable, setTradable] = useState(null);
  const [sizeProblem, setSizeProblem] = useState(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (strategy || markets.status !== "ready" || markets.open.length < 2) return;
    const seeded = seedFromMarkets(markets.open);
    if (vault.state?.bankroll > 0n) seeded.bankroll = vault.state.bankroll;
    if (vault.state?.maxOutstanding > 0n) seeded.maxOutstanding = vault.state.maxOutstanding;
    setStrategy(seeded);
  }, [strategy, markets.status, markets.open, vault.state]);

  useEffect(() => { if (initialDraft) setStrategy(initialDraft); }, [initialDraft]);
  useEffect(() => {
    if (!strategy) return;
    saveStrategy(strategy);
    if (strategy.id) upsertDraft(wallet.account, strategy);
  }, [strategy]);
  useEffect(() => {
    if (!strategy?.steps.length) return;
    if (!strategy.steps.some((s) => s.key === selected)) setSelected(strategy.steps[0].key);
  }, [strategy, selected]);

  const errors = useMemo(() => (strategy ? validate(strategy) : []), [strategy]);
  const warnings = useMemo(() => (strategy ? notices(strategy) : []), [strategy]);
  const steps = strategy?.steps ?? [];
  const step = steps.find((s) => s.key === selected);

  const marketById = (id) => markets.open.find((m) => m.marketId === id);
  const trigger = step ? marketById(step.triggerMarketId) : null;
  const successor = step ? marketById(step.successorMarketId) : null;

  // Price the follow-on order against the live book rather than a fixed guess.
  // A binary contract quoted only in YES terms means a NO order priced at a
  // YES-looking number simply never crosses, and the order fills nothing.
  const successorId = step?.successorMarketId;
  const buyingNo = step ? (step.actionOnWin0 === ACTION.BUY_NO || step.actionOnWin1 === ACTION.BUY_NO) : false;
  useEffect(() => {
    if (!successorId) { setBook(null); return; }
    let live = true;
    (async () => {
      try {
        const next = await fetchBook(successorId);
        if (!live) return;
        setBook(next);
        const cross = crossingPrice(next, buyingNo);
        if (!cross || !step.pool) return;
        // The pool has a tick, a minimum and a lot size, and it reverts rather
        // than returning false when an order misses them.
        const params = await fetchPoolParams(step.pool, publicClient());
        if (!live) return;
        const sized = sizeOrder({ price: cross, budget: step.notionalCap, ...params });
        if (!sized) { setSizeProblem(`One lot of the smallest tradable order costs more than this amount.`); return; }
        setSizeProblem(null);
        setStrategy((cur) => ({
          ...cur,
          steps: cur.steps.map((s) => (s.key === step.key ? { ...s, price: sized.price, quantity: sized.quantity } : s)),
        }));
      } catch { if (live) setBook(null); }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [successorId, buyingNo]);


  const patch = (change) => setStrategy((cur) => ({ ...cur, ...change }));
  const update = (key, change) =>
    setStrategy((cur) => ({ ...cur, steps: cur.steps.map((s) => (s.key === key ? { ...s, ...change } : s)) }));

  // Choosing a market to watch also picks the next window of the same kind to
  // trade into, so a trader never has to reason about two pickers at once.
  const chooseWatch = (key, marketId) => {
    const m = marketById(marketId);
    if (!m) return;
    const next = nextWindowFor(markets.open, m);
    update(key, {
      triggerMarketId: m.marketId, triggerLabel: m.question, triggerExpiry: m.expiry,
      ...(next ? { successorMarketId: next.marketId, successorLabel: next.question, successorExpiry: next.expiry, pool: next.pool } : {}),
    });
    setArmResult(null);
  };

  // "How much on this trade" is what a trader sets. Contracts come in whole
  // lots, so the amount is rounded down to what can actually be bought, and the
  // cap is set to exactly that. One number, shown everywhere, always true.
  const setStake = (key, dollars) => {
    const s = steps.find((x) => x.key === key);
    if (!s) return;
    const price = s.price > 0n ? s.price : 500000n;
    const target = BigInt(Math.max(0, Math.round(Number(dollars || 0) * 1e6)));
    let quantity = target / price;
    if (quantity < 1n) quantity = 1n;
    update(key, { quantity, notionalCap: price * quantity });
    setArmResult(null);
  };

  const setRolling = (count) => {
    setStrategy((cur) => {
      const next = [...cur.steps];
      while (next.length > count) next.pop();
      while (next.length < count) {
        const last = next[next.length - 1];
        const lastMarket = marketById(last?.successorMarketId);
        const following = nextWindowFor(markets.open, lastMarket);
        if (!lastMarket || !following) break;
        const added = makeStep(next.length + 1, { triggerMarket: lastMarket, successorMarket: following });
        added.price = last.price; added.quantity = last.quantity;
        added.notionalCap = last.notionalCap;
        added.actionOnWin0 = last.actionOnWin0; added.actionOnWin1 = last.actionOnWin1;
        added.orderType = last.orderType;
        next.push(added);
      }
      return { ...cur, steps: next };
    });
    setArmResult(null);
  };

  const isOwner = vault.isOwner(wallet.account);
  const ready = wallet.connected && wallet.onShannon && isOwner && !vault.state?.paused && errors.length === 0 && steps.length > 0;
  const blocker = !wallet.connected
    ? "Connect your wallet to activate this."
    : !wallet.onShannon ? "Switch your wallet to the Somnia network."
    : !vault.state ? "Reading your account…"
    : !isOwner ? "This wallet does not control the trading account."
    : vault.state.paused ? "Trading is paused. Resume it first."
    : errors.length ? errors[0].message
    : null;

  // A sequence is a chain, not a set of independent triggers. Only the first
  // step listens; the rest are queued and the vault arms each one itself, but
  // only after the step before it actually placed an order. So "if NO, stop"
  // genuinely stops everything after it.
  const activate = async () => {
    setArming(true);
    setArmResult(null);

    // The indexer can lag, and pools are recycled between windows. Confirm
    // against the module itself before asking anyone to sign.
    for (const s of strategy.steps) {
      const check = await checkTradable(s.successorMarketId, s.pool);
      if (!check.ok) {
        setArmResult({ ok: false, error: `${check.problems[0]} Pick another market and try again.` });
        setArming(false);
        setTradable(check);
        return;
      }
    }
    setTradable({ ok: true, problems: [] });

    // Every pool this sequence could execute against must be able to draw the
    // collateral, not just the first one.
    try {
      await ensurePoolAllowances({
        provider: wallet.provider, account: wallet.account,
        vault: vault.address, collateral: vault.state.collateral,
        pools: strategy.steps.map((s) => s.pool),
        amount: strategy.maxOutstanding,
      });
    } catch (cause) {
      setArmResult({ ok: false, error: cause?.shortMessage || "Could not give the market permission to draw funds." });
      setArming(false);
      return;
    }
    const done = [];
    try {
      const ids = strategy.steps.map((s) => onchainStepId(strategy, s));

      // Queue from the back so each link exists before the one pointing at it.
      for (let i = strategy.steps.length - 1; i >= 1; i -= 1) {
        const s = strategy.steps[i];
        const next = i + 1 < ids.length ? ids[i + 1] : undefined;
        await queueStep({
          provider: wallet.provider, account: wallet.account, vault: vault.address,
          stepId: ids[i], step: toVaultStep(s, Date.now(), next),
        });
      }

      for (const [i, s] of [strategy.steps[0]].entries()) {
        const stepId = ids[i];
        const result = await armStep({
          provider: wallet.provider, account: wallet.account, vault: vault.address, stepId,
          step: toVaultStep(s, Date.now(), ids[1]),
        });
        const t = marketById(s.triggerMarketId);
        const n = marketById(s.successorMarketId);
        vault.track({
          stepId, key: s.key, name: s.name, strategy: strategy.name,
          triggerLabel: t?.question || s.triggerLabel, successorLabel: n?.question || s.successorLabel,
          triggerMarketId: s.triggerMarketId, triggerExpiry: s.triggerExpiry, pool: s.pool,
          blockNumber: result.blockNumber.toString(), txHash: result.hash, armedAt: Date.now(),
        });
        done.push(result.hash);
      }
      setArmResult({ ok: true, hash: done[0], count: strategy.steps.length });
      onActivated?.(strategy);
    } catch (cause) {
      setArmResult({ ok: false, error: cause?.shortMessage || cause?.message || "That did not go through. Nothing was risked." });
    } finally {
      setArming(false);
    }
  };

  if (!strategy || !step) {
    return (
      <section id="build" className="product-band">
        <div className="mx-auto max-w-[1280px] px-7 py-14 sm:px-12 lg:px-16 lg:py-16">
          <ScreenHeader
            trail={[{ label: "Your sequences", onClick: onExit }, { label: "New sequence" }]}
            tag="Build" tagColor="#52d8ed"
            title="Set the rules. See the risk."
            back={onExit} backLabel="Back to your sequences"
          />
          <div className="workspace-card mt-10 p-10 text-[12px] text-[#77717d]">
            {markets.status === "error"
              ? <>Live markets are unavailable right now. <button onClick={markets.reload} className="font-bold text-[#6f58c2]">Try again</button></>
              : markets.status === "ready"
                ? <>Not enough markets are open to chain a sequence yet. New windows open as the current ones settle. <button onClick={markets.reload} className="font-bold text-[#6f58c2]">Check again</button></>
                : "Loading live markets…"}
          </div>
        </div>
      </section>
    );
  }

  // Only offer to roll as far as the open windows actually allow, so a choice
  // never silently does nothing.
  let reach = 1;
  {
    let cursor = successor;
    while (cursor && reach < 4) {
      const following = nextWindowFor(markets.open, cursor);
      if (!following) break;
      reach += 1;
      cursor = following;
    }
  }

  const branches = branchActions(step, successor);
  const successorName = marketName(successor) || step.successorLabel || "the next market";
  const stake = notionalOf(step);
  const odds = trigger ? asOdds(trigger.lastPrice) : null;
  const watchable = markets.open.filter((m) => m.pool);

  return (
    <section id="build" className="product-band">
      <div className="mx-auto max-w-[1280px] px-7 py-20 sm:px-12 lg:px-16 lg:py-24">
        <ScreenHeader
          trail={[{ label: "Your sequences", onClick: onExit }, { label: "New sequence" }]}
          tag="Build"
          tagColor="#52d8ed"
          title="Set the rules. See the risk."
          blurb="Pick the market you are watching, say what to do on each result, and set the most you are willing to risk. Nothing is live until you activate it."
          back={onExit}
          backLabel="Back to your sequences"
        />

        <CommandBar
          markets={markets}
          vault={vault}
          onUse={(next) => {
            setStrategy({ ...next, id: strategy?.id || newDraftId() });
            setArmResult(null);
          }}
        />

        <div className="workspace-card mt-8">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#ece9ef] px-6 py-4 lg:px-8">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-[#8b72e8] shadow-[0_0_0_5px_rgba(139,114,232,.12)]" />
              <input aria-label="Sequence name" value={strategy.name} onChange={(e) => patch({ name: e.target.value })} className="w-[210px] bg-transparent text-[13px] font-bold tracking-[-.02em] text-[#242128] outline-none" />
            </div>
            <span className="text-[10px] text-[#928d97]">{markets.status === "ready" ? `${watchable.length} markets open` : "Loading markets…"}</span>
          </div>

          <div className="grid lg:grid-cols-[1fr_320px]">
            <div className="space-y-9 p-6 lg:p-9">
              <Question n={1} title="What are you watching?">
                <select
                  className="product-input"
                  aria-label="Market to watch"
                  value={step.triggerMarketId}
                  onChange={(e) => chooseWatch(step.key, e.target.value)}
                >
                  <option value="">Choose a market…</option>
                  {watchable.map((m) => (
                    <option key={m.marketId} value={m.marketId}>
                      {marketName(m)}{marketShortAsk(m) ? ` · ${marketShortAsk(m)}` : ""} — {settlePhrase(m.expiry)}
                    </option>
                  ))}
                </select>
                {trigger && (
                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-[#7f7984]">
                    <span>{marketQuestion(trigger)}</span>
                    <span className="text-[#a19ca5]">{settlePhrase(trigger.expiry)}</span>
                    {odds !== null && <span className="odds-pill">{odds}% yes</span>}
                  </div>
                )}
              </Question>

              <Question n={2} title="What should happen when it settles?">
                <div className="space-y-3">
                  <BranchRow
                    label="If YES" tone="up"
                    value={step.actionOnWin0}
                    onChange={(v) => { update(step.key, { actionOnWin0: v }); setArmResult(null); }}
                    detail={branches.yes}
                    successorName={successorName}
                  />
                  <BranchRow
                    label="If NO" tone="down"
                    value={step.actionOnWin1}
                    onChange={(v) => { update(step.key, { actionOnWin1: v }); setArmResult(null); }}
                    detail={branches.no}
                    successorName={successorName}
                  />
                </div>
                <p className="mt-3 text-[10px] leading-[1.6] text-[#a19ca5]">
                  Each result is set on its own, so you can trade one and stop on the other. If the market is cancelled or the result is unclear, Sequence does nothing either way.
                </p>
              </Question>

              <Question n={3} title="How much on each trade?">
                <div className="grid gap-x-5 gap-y-6 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-[9px] font-bold uppercase tracking-[.12em] text-[#9d98a2]">Per trade</span>
                    <div className="input-prefix">
                      <span>$</span>
                      <input
                        type="number" step="0.5" min="0"
                        aria-label="Amount per trade"
                        // Shown to the cent, so the amount here reads exactly
                        // as it does on the branches and in the summary.
                        value={(Number(orderCost(step.price, step.quantity)) / 1e6).toFixed(2)}
                        onChange={(e) => setStake(step.key, e.target.value)}
                      />
                    </div>
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-[9px] font-bold uppercase tracking-[.12em] text-[#9d98a2]">Maximum total risk</span>
                    <div className="input-prefix">
                      <span>$</span>
                      <input
                        type="number" step="1" min="0"
                        aria-label="Maximum total risk"
                        value={Number(strategy.maxOutstanding) / 1e6}
                        onChange={(e) => patch({ maxOutstanding: BigInt(Math.max(0, Math.round(Number(e.target.value) * 1e6))) })}
                      />
                    </div>
                  </label>
                </div>
                {book && (
                  <div className="mt-4 rounded-sm border border-[#ece9ef] bg-[#fbfbfc] p-4">
                    <div className="micro-label">Live price on the market you trade into</div>
                    {book.depth === 0 ? (
                      <p className="mt-2 text-[10px] leading-[1.6] text-[#a8834f]">
                        Nothing is resting on this book yet, so there is no price to cross. The order may not fill until someone quotes it.
                      </p>
                    ) : (
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[10px] text-[#7f7984]">
                        <span>Best ask {fmt(buyingNo ? book.bestAskNo : book.bestAskYes)}</span>
                        <span className="text-[#28252c]">Your order crosses at <b className="font-bold">{fmt(step.price)}</b></span>
                        <span className="text-[#a19ca5]">{buyingNo ? "NO is priced from the YES book" : "taken from resting sell orders"}</span>
                      </div>
                    )}
                  </div>
                )}
                {sizeProblem && (
                  <p className="mt-3 text-[10px] font-semibold text-[#a8834f]">{sizeProblem}</p>
                )}
                {tradable && !tradable.ok && (
                  <p className="mt-3 text-[10px] font-semibold text-[#dc6e58]" role="alert">{tradable.problems[0]}</p>
                )}
                <p className="mt-3 text-[10px] leading-[1.6] text-[#a19ca5]">
                  Contracts trade in whole lots, so the amount rounds down to what can actually be bought. Your account enforces the total itself and will stand down any trade that would take you past it.
                </p>
              </Question>

              <Question n={4} title="And after that?">
                <div className="flex flex-wrap gap-2.5">
                  <ChoiceChip active={steps.length === 1} onClick={() => setRolling(1)}>Stop</ChoiceChip>
                  {[2, 3, 4].filter((n) => n <= reach).map((n) => (
                    <ChoiceChip key={n} active={steps.length === n} onClick={() => setRolling(n)}>
                      Keep rolling · {n} settlements
                    </ChoiceChip>
                  ))}
                </div>
                {reach === 1 && (
                  <p className="mt-3 text-[10px] leading-[1.6] text-[#a19ca5]">
                    Only one further window is open right now, so this sequence can cover one settlement. More windows open as these settle.
                  </p>
                )}
              </Question>

              <div>
                <button onClick={() => setShowRaw((v) => !v)} className="details-toggle">
                  {showRaw ? "Hide onchain details" : "Onchain details"}
                </button>
                {showRaw && (
                  <dl className="mt-4 space-y-2.5 rounded-sm border border-[#ece9ef] bg-[#fbfbfc] p-5 font-mono text-[9px] leading-[1.6] text-[#77717d]">
                    <RawRow label="Watched market id" value={step.triggerMarketId} />
                    <RawRow label="Successor market id" value={step.successorMarketId} />
                    <RawRow label="Binary pool" value={step.pool} href={step.pool ? addressUrl(step.pool) : null} />
                    <RawRow label="Limit price (raw, 6dp)" value={step.price.toString()} />
                    <RawRow label="Quantity" value={step.quantity.toString()} />
                    <RawRow label="Per-step notional cap (raw)" value={step.notionalCap.toString()} />
                    <RawRow label="Vault max outstanding (raw)" value={strategy.maxOutstanding.toString()} />
                    <RawRow label="Raw market question" value={trigger?.question || step.triggerLabel || "—"} />
                    <div className="pt-1">
                      <select
                        className="w-full bg-transparent font-mono text-[9px] text-[#77717d] outline-none"
                        aria-label="Order type"
                        value={step.orderType}
                        onChange={(e) => update(step.key, { orderType: Number(e.target.value) })}
                      >
                        {ORDER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.value} · {ORDER_TYPE_COPY[t.value]?.label}</option>)}
                      </select>
                    </div>
                  </dl>
                )}
              </div>
            </div>

            <aside className="border-t border-[#ece9ef] bg-[#fbfbfc] p-6 lg:border-l lg:border-t-0 lg:p-8">
              <div className="micro-label">What will happen</div>
              <p className="mt-4 text-[12px] leading-[1.75] text-[#3f3a47]">{describePlan(strategy, markets.open)}</p>

              <div className="mt-7 space-y-4 border-t border-[#e7e3ea] pt-6">
                <Row label="On each trade" value={step.actionOnWin0 === ACTION.STOP && step.actionOnWin1 === ACTION.STOP ? "nothing" : fmt(stake)} />
                <Row label="Trades in this sequence" value={String(steps.length)} />
                <Row label="Most at risk at once" value={fmt(strategy.maxOutstanding)} strong />
              </div>

              {warnings.length > 0 && errors.length === 0 && (
                <ul className="mt-5 space-y-2 border-t border-[#e7e3ea] pt-5 text-[10px] leading-[1.55] text-[#a8834f]">
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
              {errors.length > 0 && (
                <ul className="mt-5 space-y-2 border-t border-[#e7e3ea] pt-5 text-[10px] leading-[1.55] text-[#c47b64]">
                  {errors.slice(0, 3).map((e, i) => <li key={i}>{e.message}</li>)}
                </ul>
              )}

              <div className="mt-7">
                {wallet.connected ? (
                  <button disabled={!ready || arming} onClick={activate} className="soft-button w-full bg-[#111014] py-3 text-white disabled:opacity-35">
                    {arming ? "Approve in your wallet…" : `Activate sequence · risk ${fmt(strategy.maxOutstanding)}`}
                  </button>
                ) : (
                  <button onClick={onWallet} className="soft-button w-full bg-[#111014] py-3 text-white">Connect wallet to activate</button>
                )}
                {blocker && <p className="mt-3 text-[10px] font-semibold text-[#a8a2ad]">{blocker}</p>}
                {armResult?.ok && (
                  <p className="mt-3 text-[10px] font-semibold text-[#40906b]">
                    Live. {armResult.count > 1 ? `${armResult.count} trades are` : "It is"} waiting on the market now.{" "}
                    <a className="text-[#6f58c2]" href={txUrl(armResult.hash)} target="_blank" rel="noreferrer">Receipt ↗</a>
                  </p>
                )}
                {armResult && !armResult.ok && (
                  <p className="mt-3 text-[10px] font-semibold text-[#dc6e58]" role="alert">{armResult.error}</p>
                )}
                <p className="mt-3 text-[10px] leading-[1.55] text-[#a19ca5]">
                  You approve {steps.length === 1 ? "one transaction" : `${steps.length} transactions, one per trade`}. Only the first watches a market; each later one starts watching if the one before it trades.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}

function Question({ n, title, children }) {
  return (
    <section>
      <div className="flex items-baseline gap-3">
        <span className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border border-[#8b72e8] text-[9px] font-bold text-[#7056c9]">{n}</span>
        <h3 className="text-[16px] font-extrabold tracking-[-.03em] text-[#151318]">{title}</h3>
      </div>
      <div className="mt-4 pl-[34px]">{children}</div>
    </section>
  );
}

function BranchRow({ label, tone, value, onChange, detail, successorName }) {
  return (
    <div className={`branch-row ${tone} ${detail.stop ? "is-stop" : ""}`}>
      <span className="branch-label">{label}</span>
      <select
        className="branch-select"
        aria-label={`What happens ${label.toLowerCase()}`}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {ACTION_CHOICES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.value === 255 ? "Stop — place nothing" : `${c.label} in the next ${successorName}`}
          </option>
        ))}
      </select>
      <span className={`text-[12px] font-bold ${detail.stop ? "text-[#a19ca5]" : "text-[#151318]"}`}>{detail.size}</span>
    </div>
  );
}

function ChoiceChip({ active, onClick, children }) {
  return <button onClick={onClick} className={`choice-chip ${active ? "is-active" : ""}`}>{children}</button>;
}

function Row({ label, value, strong }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-[#8d8792]">{label}</span>
      <span className={`font-bold ${strong ? "text-[16px] tracking-[-.03em] text-[#161419]" : "text-[#312d35]"}`}>{value}</span>
    </div>
  );
}

function RawRow({ label, value, href }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0">{label}</dt>
      <dd className="truncate text-right text-[#4f4a56]">
        {href ? <a href={href} target="_blank" rel="noreferrer" className="hover:text-[#6f58c2]">{value} ↗</a> : (value || "—")}
      </dd>
    </div>
  );
}
