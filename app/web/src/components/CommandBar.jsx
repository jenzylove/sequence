import { useState } from "react";
import { parseCommand, explainState } from "../lib/command.js";
import { describeStep, money, marketHeadline } from "../lib/language.js";
import { validate, notionalOf } from "../strategy.js";

const EXAMPLES = [
  "Roll BTC three times, $2 a trade, $5 total",
  "Follow ETH for two rounds, $1 each",
  "Fade BTC twice with $2 each",
];

// Describe a sequence in your own words, read back exactly what it will do, then
// put it live. The translation is deterministic and grounded in markets that are
// actually open: it will refuse rather than invent one, and it never takes a view
// on where price is going.
export default function CommandBar({ markets, vault, onUse }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const [answer, setAnswer] = useState(null);

  const isQuestion = (t) => /^(what|what's|whats|how|why|when|where|is|are|am i|do i|status|explain)\b/i.test(t.trim()) || t.trim().endsWith("?");

  const submit = (value) => {
    const input = (value ?? text).trim();
    if (!input) return;
    setAnswer(null);
    setResult(null);

    // Questions get an answer from real state, not a new sequence.
    if (isQuestion(input)) {
      setAnswer(explainState({ vaultState: vault.state, steps: vault.steps, markets: markets.open }));
      return;
    }

    const parsed = parseCommand(input, {
      open: markets.open,
      bankroll: vault.state?.bankroll ?? 200000000n,
      accountLimit: vault.state?.maxOutstanding ?? null,
    });
    setResult(parsed);
  };

  const strategy = result?.ok ? result.strategy : null;
  const errors = strategy ? validate(strategy) : [];
  const planned = strategy ? strategy.steps.reduce((sum, s) => sum + notionalOf(s), 0n) : 0n;

  return (
    <div className="command-card mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="micro-label">Quick start</div>
          <h3 className="mt-2 text-[18px] font-extrabold tracking-[-.04em] text-[#151318]">Describe it, or set it up by hand below</h3>
        </div>
      </div>

      <form
        className="command-input mt-5"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Roll BTC 15m three times, $2 a trade, $5 total"
          aria-label="Describe the sequence you want"
        />
        <button type="submit" className="soft-button bg-[#111014] text-white">Read it back</button>
      </form>

      {!result && !answer && (
        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button key={e} onClick={() => { setText(e); submit(e); }} className="example-chip">{e}</button>
          ))}
        </div>
      )}

      {answer && (
        <div className="mt-5 rounded-sm border-l-[3px] border-[#62dbea] bg-[#f6fdfe] p-5 text-[11px] leading-[1.75] text-[#4a4650]">{answer}</div>
      )}

      {result && !result.ok && (
        <div className="mt-5 rounded-sm border-l-[3px] border-[#ff9b7f] bg-[#fff8f4] p-5 text-[11px] leading-[1.75] text-[#8a5f47]" role="alert">
          {result.reason}
        </div>
      )}

      {strategy && (
        <div className="mt-5 rounded-sm border border-[#ece9ef] bg-[#fbfbfc] p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="micro-label">Here is what that does</span>
            <span className="text-[10px] font-semibold text-[#8b72e8]">{strategy.steps.length} step{strategy.steps.length > 1 ? "s" : ""}</span>
          </div>
          <p className="mt-3 text-[13px] font-semibold leading-[1.6] text-[#242128]">{result.summary}</p>

          <ol className="mt-5 space-y-3">
            {strategy.steps.map((step, i) => {
              const trigger = markets.open.find((m) => m.marketId === step.triggerMarketId);
              const successor = markets.open.find((m) => m.marketId === step.successorMarketId);
              return (
                <li key={step.key} className="flex gap-3">
                  <span className="mt-0.5 grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full border border-[#8b72e8] bg-white text-[9px] font-bold text-[#7056c9]">{i + 1}</span>
                  <p className="text-[11px] leading-[1.7] text-[#5d5862]">{describeStep(step, { triggerMarket: trigger, successorMarket: successor })}</p>
                </li>
              );
            })}
          </ol>

          <div className="mt-6 grid grid-cols-3 gap-4 border-y border-[#ece9ef] py-5">
            <Metric label="Most you can lose" value={money(strategy.maxOutstanding)} />
            <Metric label="If every step fires" value={money(planned)} />
            <Metric label="Per trade" value={money(result.perStepCap)} />
          </div>

          {result.notes.length > 0 && (
            <ul className="mt-4 space-y-2 text-[10px] leading-[1.6] text-[#a8834f]">
              {result.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
          {errors.length > 0 && (
            <ul className="mt-4 space-y-2 text-[10px] leading-[1.6] text-[#c47b64]">
              {errors.slice(0, 3).map((e, i) => <li key={i}>{e.message}</li>)}
            </ul>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              disabled={errors.length > 0}
              onClick={() => { onUse(strategy); setResult(null); setText(""); }}
              className="soft-button bg-[#111014] text-white disabled:opacity-35"
            >
              Use this
            </button>
            <button onClick={() => { setResult(null); setText(""); }} className="text-[10px] font-semibold text-[#8f8994] transition hover:text-[#242128]">Start over</button>
            <span className="text-[10px] text-[#a19ca5]">This fills in the form below. Nothing is live until you activate it.</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <div className="text-[8px] font-bold uppercase tracking-[.12em] text-[#aaa5ae]">{label}</div>
      <div className="mt-1.5 text-[14px] font-bold text-[#302c34]">{value}</div>
    </div>
  );
}
