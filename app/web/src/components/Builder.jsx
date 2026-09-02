import { useMemo, useState } from "react";
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
    const next = [];
    if (maxOutstanding > bankroll) next.push("Vault cap is higher than the bankroll.");
    for (const step of steps) {
      if (step.price <= 0n || step.quantity <= 0n) next.push(`${step.id}: price and size must be above zero.`);
      if (step.price * step.quantity > step.notionalCap) next.push(`${step.id}: order value is over its cap.`);
    }
    return next;
  }, [steps, maxOutstanding]);

  const selectedStep = steps.find((step) => step.id === selected);
  const committed = ran?.committed ?? steps.reduce((sum, step) => sum + step.price * step.quantity, 0n);
  const exposure = Math.min(100, Number(committed) / Number(maxOutstanding) * 100);
  const update = (id, change) => setSteps((current) => current.map((step) => step.id === id ? { ...step, ...change } : step));
  const addStep = () => {
    const id = `step${steps.length + 1}`;
    setSteps((current) => [...current, { id, label: "New market", triggerMarketId: "0x00…0000", pool: "0xPOOL", price: 500000n, quantity: 4n, buyYesOnWin0: true, notionalCap: 3000000n }]);
    setSelected(id);
    setRan(null);
  };
  const removeStep = (id) => {
    const remaining = steps.filter((step) => step.id !== id);
    setSteps(remaining);
    setSelected(remaining[0]?.id ?? "");
    setRan(null);
  };
  const runSimulation = () => {
    const resolutions = steps.map((step, index) => index === 1
      ? { marketId: step.triggerMarketId, questionId: 2, payoutNumerators: [0n, 0n], voided: true }
      : { marketId: step.triggerMarketId, questionId: index + 1, payoutNumerators: [1n, 0n], voided: false });
    setRan(simulate(strat, resolutions));
  };
  const eventFor = (id) => ran?.events.find((event) => event.stepId === id);

  return (
    <section id="build" className="product-band">
      <div className="mx-auto max-w-[1280px] px-7 py-24 sm:px-12 lg:px-16 lg:py-32">
        <div className="grid items-end gap-10 lg:grid-cols-[.8fr_1.2fr]">
          <div>
            <span className="section-tag bg-[#52d8ed]">Builder</span>
            <h2 className="mt-5 max-w-[520px] text-[42px] font-extrabold leading-[1.03] tracking-[-0.055em] text-[#0b0a0e] sm:text-[54px]">Set the rules.<br />See the risk.</h2>
          </div>
          <div className="max-w-[520px] lg:justify-self-end">
            <p className="text-[14px] leading-[1.75] text-[#65616b]">Build one bounded successor at a time. Every value below maps to the same branch and cap rules enforced by the Sequence vault.</p>
            <div className="mt-5 flex gap-7 text-[10px] font-semibold uppercase tracking-[.13em] text-[#98939d]"><span>Local simulation</span><span>No funds move</span><span>Vault-aligned</span></div>
          </div>
        </div>

        <div className="workspace-card mt-16">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#ece9ef] px-6 py-4 lg:px-8">
            <div className="flex items-center gap-3"><span className="h-2 w-2 rounded-full bg-[#8b72e8] shadow-[0_0_0_5px_rgba(139,114,232,.12)]" /><span className="text-[13px] font-bold tracking-[-.02em] text-[#242128]">Untitled sequence</span><span className="text-[10px] text-[#aaa5ae]">Saved locally</span></div>
            <div className="flex items-center gap-3"><span className="hidden text-[10px] text-[#928d97] sm:block">Shannon testnet</span><button disabled={errors.length > 0} onClick={runSimulation} className="soft-button bg-[#111014] text-white disabled:opacity-35">Preview sequence</button></div>
          </div>

          <div className="grid lg:grid-cols-[300px_1fr]">
            <aside className="border-b border-[#ece9ef] bg-[#fbfbfc] p-6 lg:border-b-0 lg:border-r lg:p-8">
              <div className="mb-6 flex items-center justify-between"><div><div className="micro-label">Sequence path</div><div className="mt-1 text-[11px] text-[#99949e]">{steps.length} bounded actions</div></div><button onClick={addStep} className="grid h-8 w-8 place-items-center rounded-full border border-[#dfdbe3] bg-white text-lg font-light text-[#514c57] transition hover:border-[#8b72e8]">+</button></div>
              <div className="relative">
                <div className="absolute bottom-7 left-[11px] top-7 w-px bg-[#ded9e3]" />
                {steps.map((step, index) => {
                  const event = eventFor(step.id);
                  return (
                    <button key={step.id} onClick={() => setSelected(step.id)} className={`sequence-step group relative mb-3 text-left ${selected === step.id ? "is-selected" : ""}`}>
                      <span className={`absolute -left-[26px] top-5 grid h-[22px] w-[22px] place-items-center rounded-full border bg-white text-[9px] font-bold ${event?.action === "EXECUTED" ? "border-[#55b58a] text-[#42946f]" : event ? "border-[#d1ccd5] text-[#aaa5ae]" : "border-[#8b72e8] text-[#7056c9]"}`}>{index + 1}</span>
                      <div className="flex items-start justify-between gap-3"><div><div className="text-[12px] font-bold text-[#252229]">{step.label}</div><div className="mt-2 text-[10px] text-[#817c86]">Outcome 0 → <b className="font-semibold text-[#38343d]">{step.buyYesOnWin0 ? "Buy YES" : "Buy NO"}</b></div></div><span className={`mt-0.5 h-1.5 w-1.5 rounded-full ${event?.action === "EXECUTED" ? "bg-[#55b58a]" : event ? "bg-[#c7c2ca]" : "bg-[#8b72e8]"}`} /></div>
                      <div className="mt-4 flex justify-between border-t border-[#efecf1] pt-3 font-mono text-[9px] text-[#99949d]"><span>{fmt(step.price * step.quantity)}</span><span>cap {fmt(step.notionalCap)}</span></div>
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
                    <div className="flex items-start justify-between gap-6"><div><div className="micro-label">Edit step {steps.findIndex((step) => step.id === selectedStep.id) + 1}</div><h3 className="mt-2 text-[25px] font-extrabold tracking-[-.04em] text-[#151318]">Define the next action</h3></div>{steps.length > 1 && <button onClick={() => removeStep(selectedStep.id)} className="text-[10px] font-semibold text-[#aaa4ae] transition hover:text-[#ee7d66]">Remove</button>}</div>
                    <div className="mt-8 grid gap-x-5 gap-y-6 sm:grid-cols-2">
                      <Field label="Market label"><input className="product-input" value={selectedStep.label} onChange={(event) => update(selectedStep.id, { label: event.target.value })} /></Field>
                      <Field label="Trigger market ID"><input className="product-input font-mono" value={selectedStep.triggerMarketId} onChange={(event) => update(selectedStep.id, { triggerMarketId: event.target.value })} /></Field>
                      <Field label="Limit price"><div className="input-prefix"><span>$</span><input type="number" value={Number(selectedStep.price) / 1e6} onChange={(event) => update(selectedStep.id, { price: BigInt(Math.round(Number(event.target.value) * 1e6)) })} /></div></Field>
                      <Field label="Size"><div className="input-prefix"><input type="number" value={Number(selectedStep.quantity)} onChange={(event) => update(selectedStep.id, { quantity: BigInt(Math.max(0, Math.round(Number(event.target.value)))) })} /><span>contracts</span></div></Field>
                      <Field label="Step cap"><div className="input-prefix"><span>$</span><input type="number" value={Number(selectedStep.notionalCap) / 1e6} onChange={(event) => update(selectedStep.id, { notionalCap: BigInt(Math.round(Number(event.target.value) * 1e6)) })} /></div></Field>
                      <Field label="When outcome 0 wins"><select className="product-input" value={selectedStep.buyYesOnWin0 ? "yes" : "no"} onChange={(event) => update(selectedStep.id, { buyYesOnWin0: event.target.value === "yes" })}><option value="yes">Buy YES</option><option value="no">Buy NO</option></select></Field>
                    </div>
                  </div>
                )}

                <aside className="risk-card">
                  <div className="flex items-center justify-between"><span className="micro-label">Risk preview</span><span className={`rounded-full px-2 py-1 text-[8px] font-bold uppercase tracking-[.1em] ${errors.length ? "bg-[#fff0ec] text-[#e27259]" : "bg-[#eaf7f0] text-[#40906b]"}`}>{errors.length ? "Review" : "Within caps"}</span></div>
                  <div className="mt-7"><div className="text-[9px] uppercase tracking-[.12em] text-[#a39ea7]">Planned exposure</div><div className="mt-1 text-[30px] font-extrabold tracking-[-.05em] text-[#161419]">{fmt(committed)}</div><div className="mt-5 h-1.5 overflow-hidden rounded-full bg-[#ebe8ee]"><div className="h-full rounded-full bg-[#8b72e8] transition-all" style={{ width: `${exposure}%` }} /></div><div className="mt-2 flex justify-between font-mono text-[8px] text-[#aaa5ae]"><span>committed</span><span>{fmt(maxOutstanding)} cap</span></div></div>
                  <div className="mt-7 space-y-4 border-t border-[#e7e3ea] pt-5"><RiskRow label="Bankroll" value={fmt(bankroll)} /><RiskRow label="Outstanding cap" value={<input aria-label="Vault cap" className="w-[62px] bg-transparent text-right font-mono outline-none" type="number" value={Number(maxOutstanding) / 1e6} onChange={(event) => setMaxOutstanding(BigInt(Math.round(Number(event.target.value) * 1e6)))} />} /><RiskRow label="Cap checks" value={errors.length ? `${errors.length} issue` : "Passing"} good={!errors.length} /></div>
                </aside>
              </div>

              <div className={`simulation-strip mt-10 ${ran ? "has-result" : ""}`}>
                <div><div className="micro-label">Simulation</div><p className="mt-2 max-w-[520px] text-[11px] leading-[1.65] text-[#77717d]">Replay the plan against a controlled resolution stream using the same winner, branch, idempotency, and cap logic as the vault.</p></div>
                {errors.length > 0 ? <div className="text-[10px] font-semibold text-[#dc6e58]">{errors[0]}</div> : ran ? <div className="flex flex-wrap items-center gap-5">{ran.events.map((event) => <span key={event.stepId} className="flex items-center gap-2 text-[10px] text-[#68636d]"><i className={`h-1.5 w-1.5 rounded-full ${event.action === "EXECUTED" ? "bg-[#55b58a]" : "bg-[#c7c2ca]"}`} />{event.action === "EXECUTED" ? `${KIND_LABEL[event.kind]} · ${fmt(event.notional)}` : `Skipped · ${event.reason}`}</span>)}<button onClick={runSimulation} className="soft-button border border-[#dcd7e1] bg-white text-[#252229]">Run again</button></div> : <button onClick={runSimulation} className="soft-button bg-[#111014] text-white">Run preview</button>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }) { return <label className="block"><span className="mb-2 block text-[9px] font-bold uppercase tracking-[.12em] text-[#9d98a2]">{label}</span>{children}</label>; }
function RiskRow({ label, value, good }) { return <div className="flex items-center justify-between text-[10px]"><span className="text-[#8d8792]">{label}</span><span className={`font-semibold ${good ? "text-[#40906b]" : "text-[#312d35]"}`}>{value}</span></div>; }
