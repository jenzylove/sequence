import { useMemo, useState } from "react";
import Chip from "./Chip.jsx";
import { simulate, fmt, KIND_LABEL } from "../sim.js";

const seed = () => ([
  { id: "step1", label: "BTC · 02SEP 13:45", triggerMarketId: "0x00…f920", pool: "0xPOOL-btc", price: 600000n, quantity: 5n, buyYesOnWin0: true, notionalCap: 4000000n },
  { id: "step2", label: "ETH · 02SEP 14:00", triggerMarketId: "0x00…f921", pool: "0xPOOL-eth", price: 480000n, quantity: 6n, buyYesOnWin0: false, notionalCap: 3500000n },
]);

export default function Builder() {
  const [steps, setSteps] = useState(seed);
  const [maxOutstanding, setMaxOutstanding] = useState(5000000n);
  const bankroll = 10000000n;
  const [selected, setSelected] = useState("step1");
  const [ran, setRan] = useState(null);

  const strat = useMemo(() => ({ steps, maxOutstanding, bankroll }), [steps, maxOutstanding]);
  const errors = useMemo(() => {
    const e = [];
    if (maxOutstanding > bankroll) e.push("Vault cap is higher than the bankroll.");
    for (const s of steps) {
      if (s.price <= 0n || s.quantity <= 0n) e.push(`${s.id}: price and size must be above zero.`);
      if (s.price * s.quantity > s.notionalCap) e.push(`${s.id}: order value ${fmt(s.price * s.quantity)} is over its cap ${fmt(s.notionalCap)}.`);
    }
    return e;
  }, [steps, maxOutstanding]);

  const sel = steps.find((s) => s.id === selected);
  const update = (id, patch) => setSteps((p) => p.map((s) => s.id === id ? { ...s, ...patch } : s));
  const addStep = () => {
    const id = "step" + (steps.length + 1);
    setSteps((p) => [...p, { id, label: "New market", triggerMarketId: "0x00…0000", pool: "0xPOOL", price: 500000n, quantity: 4n, buyYesOnWin0: true, notionalCap: 3000000n }]);
    setSelected(id);
  };
  const removeStep = (id) => { setSteps((p) => p.filter((s) => s.id !== id)); if (selected === id) setSelected(steps[0].id); };
  const runSim = () => {
    const res = steps.map((s, i) => i === 1
      ? { marketId: s.triggerMarketId, questionId: 2, payoutNumerators: [0n, 0n], voided: true }
      : { marketId: s.triggerMarketId, questionId: i + 1, payoutNumerators: [1n, 0n], voided: false });
    setRan(simulate(strat, res));
  };
  const evFor = (id) => ran?.events.find((e) => e.stepId === id);
  const tone = (id) => { const e = evFor(id); return !e ? "armed" : e.action === "EXECUTED" ? "triggered" : "skipped"; };
  const label = (id) => { const e = evFor(id); return !e ? "Armed" : e.action === "EXECUTED" ? "Triggered" : "Skipped"; };

  return (
    <section id="build" className="border-t border-line bg-white">
      <div className="mx-auto max-w-6xl px-8 py-14">
        <h2 className="text-2xl font-bold tracking-[-0.02em] text-ink">Build your sequence</h2>
        <p className="mt-1.5 text-[15px] text-sub">Chain bounded orders to real settlements. Simulate before you arm.</p>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-[330px_1fr] gap-7">
          {/* chain */}
          <div>
            <div className="text-[13px] font-medium text-faint mb-3.5">Strategy chain</div>
            {steps.map((s, i) => {
              const e = evFor(s.id);
              const dot = e ? (e.action === "EXECUTED" ? "border-ok" : "border-faint") : "border-accent";
              return (
                <div key={s.id} className="relative pl-8 mb-3.5">
                  {i < steps.length - 1 && <div className="absolute left-[9px] top-[30px] -bottom-3.5 w-0.5 bg-line" />}
                  <div className={`absolute left-0.5 top-[18px] h-4 w-4 rounded-full border-2 bg-white ${dot}`} />
                  <button onClick={() => setSelected(s.id)}
                    className={`w-full text-left rounded-xl border bg-white p-3.5 transition ${selected === s.id ? "border-accent ring-4 ring-accentSoft" : "border-line shadow-soft hover:border-accent"}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[14px] text-ink">{s.label}</span>
                      <Chip tone={tone(s.id)}>{label(s.id)}</Chip>
                    </div>
                    <div className="mt-2 text-[12.5px] text-sub">outcome 0 wins → <b className="text-ink">{s.buyYesOnWin0 ? "Buy YES" : "Buy NO"}</b></div>
                    <div className="mt-1.5 font-mono text-[11px] text-faint">{fmt(s.price * s.quantity)} · cap {fmt(s.notionalCap)}</div>
                    {e?.reason && <div className="mt-1.5 text-[11.5px] text-faint">skipped: {e.reason}</div>}
                    {e?.action === "EXECUTED" && <div className="mt-1.5 text-[11.5px] font-medium text-ok">{KIND_LABEL[e.kind]} placed · {fmt(e.notional)}</div>}
                  </button>
                </div>
              );
            })}
            <button onClick={addStep} className="w-full rounded-lg border border-line bg-white px-4 py-2.5 text-[13px] font-medium text-ink transition hover:border-faint">+ Add step</button>
          </div>

          {/* editor + sim */}
          <div>
            {sel && (
              <div className="rounded-2xl border border-line bg-paper p-5 mb-5">
                <div className="flex items-center justify-between mb-4">
                  <span className="font-semibold text-ink">Edit step</span>
                  {steps.length > 1 && <button onClick={() => removeStep(sel.id)} className="rounded-lg border border-line bg-white px-3.5 py-2 text-[13px] hover:border-faint">Remove</button>}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Market label"><input className="in" value={sel.label} onChange={(e) => update(sel.id, { label: e.target.value })} /></Field>
                  <Field label="Trigger market id"><input className="in font-mono" value={sel.triggerMarketId} onChange={(e) => update(sel.id, { triggerMarketId: e.target.value })} /></Field>
                  <Field label="Limit price ($)"><input className="in font-mono" type="number" value={Number(sel.price)/1e6} onChange={(e) => update(sel.id, { price: BigInt(Math.round(Number(e.target.value)*1e6)) })} /></Field>
                  <Field label="Size (contracts)"><input className="in font-mono" type="number" value={Number(sel.quantity)} onChange={(e) => update(sel.id, { quantity: BigInt(Math.max(0, Math.round(Number(e.target.value)))) })} /></Field>
                  <Field label="Step cap ($)"><input className="in font-mono" type="number" value={Number(sel.notionalCap)/1e6} onChange={(e) => update(sel.id, { notionalCap: BigInt(Math.round(Number(e.target.value)*1e6)) })} /></Field>
                  <Field label="Branch"><select className="in" value={sel.buyYesOnWin0 ? "yes" : "no"} onChange={(e) => update(sel.id, { buyYesOnWin0: e.target.value === "yes" })}><option value="yes">Outcome 0 wins → Buy YES</option><option value="no">Outcome 0 wins → Buy NO</option></select></Field>
                </div>
                <div className="mt-3.5 text-[12.5px] text-sub">Order value <span className={`font-mono font-medium ${sel.price*sel.quantity > sel.notionalCap ? "text-red-500" : "text-ink"}`}>{fmt(sel.price*sel.quantity)}</span> of {fmt(sel.notionalCap)} cap</div>
              </div>
            )}

            <div className="rounded-2xl border border-line bg-white p-5 shadow-soft">
              <div className="flex items-center justify-between mb-4">
                <span className="font-semibold text-ink">Simulation</span>
                <div className="flex items-center gap-3">
                  <span className="text-[12.5px] text-sub">Vault cap</span>
                  <input className="in font-mono w-[88px]" type="number" value={Number(maxOutstanding)/1e6} onChange={(e) => setMaxOutstanding(BigInt(Math.round(Number(e.target.value)*1e6)))} />
                  <button disabled={errors.length>0} onClick={runSim}
                    className="rounded-lg bg-ink px-4 py-2.5 text-[14px] font-semibold text-white transition enabled:hover:-translate-y-0.5 disabled:opacity-40">Run simulation</button>
                </div>
              </div>
              {errors.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-[12.5px] text-red-600 space-y-0.5">
                  {errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}
              {!ran && errors.length === 0 && (
                <p className="py-3.5 text-[13.5px] leading-relaxed text-sub">Replays your chain against a sample stream — first step settles with a winner, second voids — using the same branch and cap rules the on-chain vault enforces. No funds move.</p>
              )}
              {ran && (
                <div>
                  <div className="mb-4 flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-line/60">
                      <div className="h-full bg-accent" style={{ width: Math.min(100, Number(ran.committed)/Number(maxOutstanding)*100) + "%" }} />
                    </div>
                    <span className="font-mono text-[12px] text-sub">{fmt(ran.committed)} / {fmt(maxOutstanding)}</span>
                  </div>
                  {ran.events.map((e, i) => (
                    <div key={i} className={`flex items-center justify-between py-2.5 ${i < ran.events.length-1 ? "border-b border-line" : ""}`}>
                      <span className="text-[13px] text-ink">{steps.find(s => s.id === e.stepId)?.label || e.stepId}</span>
                      {e.action === "EXECUTED"
                        ? <span className="text-[12.5px] font-medium text-ok">{KIND_LABEL[e.kind]} · {fmt(e.notional)}</span>
                        : <span className="text-[12.5px] text-faint">skipped · {e.reason}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }) {
  return <label className="block"><div className="mb-1.5 text-[12px] font-medium text-sub">{label}</div>{children}</label>;
}
