import { useEffect, useState } from "react";
import ScreenHeader from "./ScreenHeader.jsx";
import { DEMO_STAGES, DEMO_VAULT } from "../lib/demoRun.js";
import { txUrl, addressUrl } from "../chain/config.js";

// What the landing page's second link actually promises: watching a sequence run.
//
// It used to scroll 500px down to four static cards, which is not a thing
// happening — it is more copy. This plays a real recorded run, one stage at a
// time, and every stage links to the transaction that produced it.
export default function DemoRun({ onBuild }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const stage = DEMO_STAGES[index];
  const last = index === DEMO_STAGES.length - 1;

  useEffect(() => {
    if (!playing || last) return undefined;
    const timer = window.setTimeout(() => setIndex((i) => i + 1), 5200);
    return () => window.clearTimeout(timer);
  }, [playing, index, last]);

  return (
    <section id="demo" className="dashboard-shell">
      <div className="mx-auto max-w-[1280px] px-7 py-14 sm:px-12 lg:px-16 lg:py-16">
        <ScreenHeader
          trail={[{ label: "Watch a run" }]}
          tag="Watch a run"
          title="One sequence, start to finish."
          blurb="A real run on the Somnia test network, replayed stage by stage. It was armed once and then advanced by the network on its own. Every number was read back off the chain, and every stage links to the transaction that produced it."
        />

        <div className="mt-9 flex flex-wrap items-center gap-2">
          {DEMO_STAGES.map((s, i) => (
            <button
              key={s.key}
              onClick={() => { setPlaying(false); setIndex(i); }}
              aria-current={i === index}
              className={`rounded-full px-3.5 py-1.5 text-[10px] font-bold transition ${
                i === index ? "bg-[#111014] text-white"
                : i < index ? "bg-[#efedf5] text-[#6f58c2]"
                : "bg-[#f4f3f7] text-[#a8a2ad]"}`}
            >
              {i + 1}. {s.label}
            </button>
          ))}
          <button
            onClick={() => { if (last) { setIndex(0); setPlaying(true); } else setPlaying((p) => !p); }}
            className="ml-1 text-[10px] font-bold text-[#6f58c2]"
          >
            {last ? "Replay" : playing ? "Pause" : "Play"}
          </button>
        </div>

        <div className="workspace-card mt-6 max-w-[820px]">
          <div className="p-7 lg:p-9">
            <div className="micro-label">
              {stage.separate ? "A separate proven step" : `Stage ${index + 1} of ${DEMO_STAGES.length}`}
            </div>
            <h3 className="mt-2.5 text-[24px] font-extrabold tracking-[-.04em] text-[#151318]">{stage.title}</h3>

            {/* Two runs must not be blurred into one story. */}
            {stage.separate && (
              <p className="mt-3 rounded-sm border border-[#e6e2ee] bg-[#faf9fd] px-4 py-3 text-[10px] leading-[1.7] text-[#6f6879]">
                <strong className="font-bold text-[#4b4650]">From a different run.</strong> The four stages above are one
                continuous run whose position is still open. This step is shown from an earlier run on the same account,
                so that the full cycle is evidenced rather than implied.
              </p>
            )}
            <p className="mt-3.5 max-w-[560px] text-[13px] leading-[1.75] text-[#5f5a66]">{stage.plain}</p>
            <p className="mt-3 max-w-[560px] text-[11px] leading-[1.75] text-[#8b8590]">{stage.detail}</p>

            <div className="mt-7 grid gap-4 border-t border-[#ece9ef] pt-6 sm:grid-cols-3">
              {stage.facts.map(([label, value]) => (
                <div key={label}>
                  <div className="text-[9px] uppercase tracking-[0.1em] text-[#a29da6]">{label}</div>
                  <div className="mt-1 break-all text-[11px] font-semibold text-[#28252c]">{value}</div>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-5">
              <a href={txUrl(stage.tx)} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-[#6f58c2]">
                {stage.txLabel} ↗
              </a>
              <a href={addressUrl(DEMO_VAULT)} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-[#a8a2ad]">
                The account this ran in ↗
              </a>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#ece9ef] px-7 py-5 lg:px-9">
            <div className="flex gap-3">
              <button
                disabled={index === 0}
                onClick={() => { setPlaying(false); setIndex((i) => i - 1); }}
                className="soft-button bg-[#f2f1f5] px-4 py-2 text-[#4b4650] disabled:opacity-35"
              >
                Back
              </button>
              <button
                disabled={last}
                onClick={() => { setPlaying(false); setIndex((i) => i + 1); }}
                className="soft-button bg-[#111014] px-4 py-2 text-white disabled:opacity-35"
              >
                Next stage
              </button>
            </div>
            {last && (
              <button onClick={onBuild} className="soft-button bg-[#6f58c2] px-5 py-2 text-white">
                Build one of these →
              </button>
            )}
          </div>
        </div>

        <p className="mt-6 max-w-[820px] text-[10px] leading-[1.7] text-[#a19ca5]">
          Stages 1 to 4 are one run, advanced by Somnia Reactivity with no manual step. Redemption is shown from an
          earlier run on the same account, because the run above has not settled yet. Test network: the funds shown are
          test tokens with no real value.
        </p>
      </div>
    </section>
  );
}
