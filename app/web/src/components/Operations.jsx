import { useState } from "react";

const timeline = [
  { time: "13:45:02", title: "Answer delivered", detail: "OracleHub emitted the verified market resolution signature.", label: "OracleHub", tone: "cyan" },
  { time: "13:45:03", title: "Subscription invoked", detail: "Somnia Reactivity forwarded the matching settlement to SequenceHandler.", label: "Reactivity", tone: "violet" },
  { time: "13:45:03", title: "Step consumed", detail: "The handler marked the trigger as consumed before preparing its successor.", label: "Handler", tone: "coral" },
  { time: "13:45:04", title: "Bounded order prepared", detail: "Buy YES · $3.00 notional · inside the $4.00 step cap.", label: "Vault", tone: "green" },
];

export default function Operations({ walletConnected, onWallet }) {
  const [view, setView] = useState("active");

  return (
    <section id="how-it-works" className="operations-shell">
      <div className="mx-auto max-w-[1280px] px-7 py-24 sm:px-12 lg:px-16 lg:py-32">
        <div className="grid gap-10 lg:grid-cols-[.95fr_1.05fr] lg:items-end">
          <div>
            <span className="section-tag bg-[#ff9b7f]">Live state</span>
            <h2 className="mt-5 max-w-[600px] text-[42px] font-extrabold leading-[1.03] tracking-[-0.055em] text-[#0b0a0e] sm:text-[54px]">Know what happened.<br />Know what comes next.</h2>
          </div>
          <p className="max-w-[480px] text-[14px] leading-[1.75] text-[#65616b] lg:justify-self-end">Sequence presents automation as a calm, inspectable chain—not a wall of market data. Current exposure, the armed successor, and each verified transition stay in one readable thread.</p>
        </div>

        <div className="wallet-strip mt-16">
          <div className="flex items-center gap-4">
            <span className={`grid h-10 w-10 place-items-center rounded-full ${walletConnected ? "bg-[#e8f7ef]" : "bg-[#f1eef5]"}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${walletConnected ? "bg-[#55b58a]" : "bg-[#aaa4ae]"}`} />
            </span>
            <div>
              <div className="text-[12px] font-bold text-[#242128]">{walletConnected ? "Wallet connected" : "Connect to arm this sequence"}</div>
              <div className="mt-1 text-[10px] text-[#99949e]">{walletConnected ? "0x7A2E…C91F · Shannon testnet" : "Build and simulate without connecting. A wallet is only needed to fund and arm."}</div>
            </div>
          </div>
          {walletConnected ? (
            <div className="flex items-center gap-8">
              <WalletMetric label="Available" value="$10.00 tUSDC" />
              <WalletMetric label="Vault" value="$5.00 armed" />
              <button onClick={onWallet} className="text-[10px] font-semibold text-[#8f8994] hover:text-[#242128]">Disconnect</button>
            </div>
          ) : <button onClick={onWallet} className="soft-button bg-[#111014] text-white">Connect wallet</button>}
        </div>

        <div className="mt-6 flex gap-7 border-b border-[#e5e1e8]">
          <button onClick={() => setView("active")} className={`state-tab ${view === "active" ? "is-active" : ""}`}>Active sequence</button>
          <button onClick={() => setView("history")} className={`state-tab ${view === "history" ? "is-active" : ""}`}>Execution proof</button>
        </div>

        <div className="mt-10 grid gap-12 lg:grid-cols-[.9fr_1.1fr] lg:items-start">
          <div className="relative min-h-[600px]">
            <div className="absolute left-4 top-6 h-16 w-16 dotted-coral opacity-50" />
            <div className="absolute bottom-10 right-3 h-32 w-48 bg-[#c6f3f7] [clip-path:polygon(12%_0,100%_16%,88%_100%,0_78%)]" />
            <svg className="absolute left-0 top-32 h-52 w-32" viewBox="0 0 130 210" fill="none" aria-hidden="true"><path d="M8 20c82 0 4 82 74 89 58 6 40 59 6 82" stroke="#39353d" strokeWidth="1"/><path d="m88 191-3-11m3 11 11-5" stroke="#39353d" strokeWidth="1"/></svg>

            <article className="active-card relative z-[2] ml-auto max-w-[430px]">
              <div className="flex items-center justify-between border-b border-[#ece9ef] px-7 py-5">
                <div className="flex items-center gap-3"><span className="h-2 w-2 rounded-full bg-[#55b58a] shadow-[0_0_0_5px_rgba(85,181,138,.12)]" /><span className="text-[11px] font-bold text-[#2a272e]">Sequence active</span></div>
                <span className="font-mono text-[9px] text-[#a19ca5]">SEQ-02F9</span>
              </div>
              <div className="p-7">
                <div className="flex items-end justify-between"><div><div className="micro-label">Waiting for</div><h3 className="mt-2 text-[24px] font-extrabold tracking-[-.04em] text-[#151318]">BTC settlement</h3></div><span className="text-[10px] font-semibold text-[#8b72e8]">Step 1 of 2</span></div>
                <div className="mt-7 h-1 overflow-hidden rounded-full bg-[#ebe8ee]"><div className="h-full w-1/2 rounded-full bg-[#8b72e8]" /></div>
                <div className="mt-8 grid grid-cols-3 gap-4 border-y border-[#ece9ef] py-6"><StateMetric label="Committed" value="$3.00" /><StateMetric label="Vault cap" value="$5.00" /><StateMetric label="Remaining" value="$2.00" /></div>
                <div className="mt-7 rounded-sm border-l-[3px] border-[#8b72e8] bg-[#f8f7fc] p-5">
                  <div className="micro-label">Armed successor</div>
                  <div className="mt-3 flex items-start justify-between gap-5"><div><div className="text-[13px] font-bold text-[#28252c]">ETH · 02SEP 14:00</div><div className="mt-1.5 text-[10px] text-[#85808a]">If outcome 0 wins → Buy YES</div></div><span className="rounded-full bg-[#eeeafd] px-2.5 py-1 text-[8px] font-bold uppercase tracking-[.1em] text-[#7056c9]">Ready</span></div>
                </div>
                <div className="mt-7 flex items-center justify-between"><span className="text-[10px] text-[#99949e]">Armed 6 minutes ago</span><button className="text-[10px] font-bold text-[#2a272e]">Pause sequence</button></div>
              </div>
            </article>
          </div>

          <article id="proof" className="proof-card">
            <div className="flex items-start justify-between gap-6 border-b border-[#ece9ef] px-7 py-6">
              <div><div className="micro-label">Execution proof</div><h3 className="mt-2 text-[24px] font-extrabold tracking-[-.04em] text-[#151318]">A readable onchain trail</h3></div>
              <span className="rounded-full bg-[#eaf7f0] px-3 py-1.5 text-[8px] font-bold uppercase tracking-[.1em] text-[#40906b]">Verified path</span>
            </div>
            <div className="px-7 py-3">
              {timeline.map((item, index) => (
                <div key={item.title} className="proof-row">
                  <div className="font-mono text-[9px] text-[#aaa5ae]">{item.time}</div>
                  <div className="relative pl-7">
                    {index < timeline.length - 1 && <span className="absolute left-[5px] top-5 h-[calc(100%+20px)] w-px bg-[#e2dee5]" />}
                    <span className={`proof-dot ${item.tone}`} />
                    <div className="flex flex-wrap items-baseline justify-between gap-3"><h4 className="text-[12px] font-bold text-[#2a272e]">{item.title}</h4><span className="text-[8px] font-bold uppercase tracking-[.12em] text-[#a19ca5]">{item.label}</span></div>
                    <p className="mt-2 max-w-[390px] text-[10px] leading-[1.65] text-[#7f7984]">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#faf9fb] px-7 py-5"><span className="font-mono text-[9px] text-[#99949e]">AnswerDelivered(bytes32,uint256,uint256[])</span><button className="text-[9px] font-bold text-[#6f58c2]">View provenance ↗</button></div>
          </article>
        </div>
      </div>
    </section>
  );
}

function WalletMetric({ label, value }) { return <div className="hidden sm:block"><div className="text-[8px] font-bold uppercase tracking-[.12em] text-[#aaa5ae]">{label}</div><div className="mt-1 text-[10px] font-semibold text-[#302c34]">{value}</div></div>; }
function StateMetric({ label, value }) { return <div><div className="text-[8px] font-bold uppercase tracking-[.12em] text-[#aaa5ae]">{label}</div><div className="mt-1.5 text-[13px] font-bold text-[#302c34]">{value}</div></div>; }
