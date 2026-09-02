export default function Hero({ onBuild }) {
  return (
    <main className="relative overflow-hidden">
      <div className="mx-auto grid min-h-[670px] max-w-[1280px] grid-cols-1 items-center gap-12 px-7 pb-20 pt-12 sm:px-12 lg:grid-cols-[0.82fr_1.18fr] lg:px-16 lg:pb-24 lg:pt-10">
        <div className="relative z-10 max-w-[510px]">
          <p className="mb-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#76717d]">Outcome-driven execution</p>
          <h1 className="text-[52px] font-extrabold leading-[0.98] tracking-[-0.065em] text-[#09090b] sm:text-[68px] lg:text-[74px]">
            Plan the next<br />move now.
          </h1>
          <p className="mt-7 max-w-[390px] text-[14px] leading-[1.7] text-[#6c6871]">
            Sequence turns a market’s settlement into your next bounded action—so the strategy continues exactly as planned, without waiting on you.
          </p>
          <div className="mt-9 flex items-center gap-5">
            <button onClick={onBuild} className="rounded-full bg-[#09090b] px-7 py-3.5 text-[12px] font-semibold text-white shadow-[0_14px_30px_-16px_rgba(0,0,0,.65)] transition hover:-translate-y-0.5 hover:bg-[#29272d]">
              Build your sequence
            </button>
            <span className="hidden text-[11px] leading-4 text-[#918d96] sm:block">Simulate first.<br />Funds stay put.</span>
          </div>
          <p className="mt-12 font-mono text-[10px] uppercase tracking-[0.12em] text-[#9d99a1]">
            DreamDEX → Somnia Reactivity → bounded order
          </p>
        </div>

        <div className="sequence-visual relative mx-auto h-[520px] w-full max-w-[650px] lg:mx-0">
          <div className="absolute left-[7%] top-[48%] h-16 w-16 opacity-70 dotted-coral" />
          <div className="absolute bottom-[4%] left-[22%] h-[185px] w-[255px] bg-[#c6f3f7] opacity-80 [clip-path:polygon(22%_0,100%_12%,92%_100%,0_88%)]" />
          <svg className="absolute inset-0 z-[1] h-full w-full" viewBox="0 0 650 520" fill="none" aria-hidden="true">
            <path d="M196 130c-18-43 20-85 68-73 50 12 28 68 57 83 28 15 65-7 86 22 16 22 3 54-19 68" stroke="#302D35" strokeWidth="1.15"/>
            <path d="M195 130l-7-12m7 12 14-1" stroke="#302D35" strokeWidth="1.15"/>
          </svg>

          <article className="float-card absolute left-[30%] top-[2%] z-[4] w-[250px] border-l-[4px] border-[#62dbea] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="eyebrow">Step 01 · Watching</div>
                <h3 className="card-title">Await settlement</h3>
              </div>
              <span className="status-dot bg-[#65dbe9]" />
            </div>
            <div className="mt-5 border-t border-[#efedf1] pt-4">
              <div className="text-[12px] font-semibold text-[#242128]">BTC above $61,500?</div>
              <div className="mt-2 flex justify-between font-mono text-[9px] text-[#928d97]"><span>DreamDEX</span><span>13:45 UTC</span></div>
            </div>
          </article>

          <article className="float-card absolute right-[0%] top-[20%] z-[3] w-[228px] border-l-[4px] border-[#ff9b7f] p-5">
            <div className="eyebrow">When resolved</div>
            <h3 className="card-title">Read the outcome</h3>
            <div className="mt-5 space-y-3 border-t border-[#efedf1] pt-4 text-[10px]">
              <div className="flex justify-between"><span className="text-[#827d87]">YES wins</span><b className="font-semibold text-[#27242b]">Continue</b></div>
              <div className="flex justify-between"><span className="text-[#827d87]">NO wins</span><b className="font-semibold text-[#27242b]">Resize</b></div>
            </div>
          </article>

          <article className="float-card absolute bottom-[9%] left-[18%] z-[5] w-[330px] border-l-[4px] border-[#8a70e8] p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="eyebrow">Step 02 · Armed</div>
                <h3 className="card-title">Place the next order</h3>
              </div>
              <span className="rounded-full bg-[#f0ecff] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#7056c9]">Bounded</span>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-2 border-t border-[#efedf1] pt-4">
              <Metric label="Side" value="Buy YES" />
              <Metric label="Size" value="$3.00" />
              <Metric label="Cap" value="$4.00" />
            </div>
          </article>
        </div>
      </div>
    </main>
  );
}

function Metric({ label, value }) {
  return <div><div className="text-[9px] uppercase tracking-[0.1em] text-[#a29da6]">{label}</div><div className="mt-1 text-[11px] font-semibold text-[#28252c]">{value}</div></div>;
}
