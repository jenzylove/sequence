import Chip from "./Chip.jsx";

// SmartList-style: bold headline + subtext + single CTA on the left; a cluster of
// real Sequence state panels on the right, connected by thin curved rails.
export default function Hero({ onBuild }) {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto max-w-6xl px-8 pt-20 pb-24 grid grid-cols-1 lg:grid-cols-[minmax(0,480px)_1fr] gap-12 items-center">
        {/* left */}
        <div>
          <h1 className="text-[46px] leading-[1.05] font-extrabold tracking-[-0.03em] text-ink">
            Set the next trade<br />before this one <span className="text-accentDeep">settles.</span>
          </h1>
          <p className="mt-6 text-[17px] leading-relaxed text-sub max-w-[440px]">
            Choose what Sequence should do after each outcome — enter the next DreamDEX market, change size, or stop. Settlement triggers the next step automatically.
          </p>
          <div className="mt-8">
            <button onClick={onBuild}
              className="rounded-xl bg-ink px-6 py-3.5 text-[15px] font-semibold text-white shadow-[0_12px_28px_-12px_rgba(14,21,38,.55)] transition hover:-translate-y-0.5">
              Build a Sequence
            </button>
          </div>
          <p className="mt-7 font-mono text-[12.5px] text-faint">
            DreamDEX settlement → Somnia Reactivity → next bounded order
          </p>
        </div>

        {/* right: floating panels + rails */}
        <div className="relative h-[440px] hidden lg:block">
          <svg className="absolute inset-0 h-full w-full" aria-hidden>
            <path d="M 120 96 C 210 140, 220 210, 300 232" fill="none" stroke="#BFD4F4" strokeWidth="1.6" strokeDasharray="1 7" strokeLinecap="round" />
            <path d="M 330 250 C 300 320, 220 330, 175 360" fill="none" stroke="#BFD4F4" strokeWidth="1.6" strokeDasharray="1 7" strokeLinecap="round" />
          </svg>

          {/* current market */}
          <div className="absolute left-0 top-8 w-[236px] rounded-2xl border border-line bg-white p-4 shadow-float">
            <div className="text-[11px] text-faint">Current market</div>
            <div className="mt-1 font-semibold text-[15px] text-ink">BTC above $61,500?</div>
            <div className="mt-1.5 font-mono text-[11px] text-faint">DreamDEX · 02SEP 13:45</div>
            <div className="mt-3 flex items-center justify-between">
              <Chip tone="waiting">Settling soon</Chip>
              <span className="font-mono text-[11px] text-sub">held $2.00</span>
            </div>
          </div>

          {/* next order */}
          <div className="absolute right-2 top-[188px] w-[224px] rounded-2xl border border-accent bg-white p-4 shadow-float ring-4 ring-accentSoft">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[15px] text-ink">Buy YES</span>
              <Chip tone="armed">Armed</Chip>
            </div>
            <div className="mt-1.5 font-mono text-[11px] text-faint">ETH · 02SEP 14:00</div>
            <div className="mt-3 flex justify-between text-[12.5px] text-sub">
              <span>size <b className="font-mono text-ink">$3.00</b></span>
              <span>cap <b className="font-mono text-ink">$4.00</b></span>
            </div>
          </div>

          {/* branch */}
          <div className="absolute left-6 bottom-2 w-[210px] rounded-2xl border border-line bg-white p-4 shadow-soft">
            <div className="text-[11px] text-faint mb-2">On settlement</div>
            <div className="space-y-1.5 text-[12.5px]">
              <div className="flex justify-between"><span className="font-medium text-ok">YES wins</span><span className="text-sub">→ continue</span></div>
              <div className="flex justify-between"><span className="font-medium text-ink">NO wins</span><span className="text-sub">→ resize</span></div>
              <div className="flex justify-between"><span className="font-medium text-faint">Void</span><span className="text-sub">→ stop</span></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
