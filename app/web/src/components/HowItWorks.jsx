// The public explanation of the product. Deliberately static: no wallet state,
// no account balances, no contract addresses. A visitor who has never heard of
// Somnia should be able to read this and know what Sequence does.
const STEPS = [
  {
    title: "Pick the market you are watching",
    body: "A rolling BTC or ETH market that settles every few minutes. You choose which one.",
  },
  {
    title: "Say what to do on each result",
    body: "If it closes up, buy one side in the next window. If it closes down, buy the other. You decide which way round, and how much.",
  },
  {
    title: "Set the most you can lose",
    body: "One number covering everything you have running. It is enforced for you, not just displayed.",
  },
  {
    title: "Activate once, then walk away",
    body: "The moment the market settles, your next trade goes in on its own. No bot to run, no keys to hand over, nothing to watch.",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="explain-band">
      <div className="mx-auto max-w-[1280px] px-7 py-24 sm:px-12 lg:px-16 lg:py-28">
        <div className="grid items-end gap-10 lg:grid-cols-[.85fr_1.15fr]">
          <div>
            <span className="section-tag bg-[#ff9b7f]">How it works</span>
            <h2 className="mt-5 max-w-[560px] text-[42px] font-extrabold leading-[1.03] tracking-[-0.055em] text-[#0b0a0e] sm:text-[52px]">
              Decide once.<br />It trades the moment it settles.
            </h2>
          </div>
          <p className="max-w-[480px] text-[14px] leading-[1.75] text-[#65616b] lg:justify-self-end">
            Rolling markets settle every few minutes, and acting on the result means being at your desk for every one. Sequence takes the decision you already made and carries it out for you, within limits you set in advance.
          </p>
        </div>

        <ol className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="explain-step">
              <span className="grid h-[24px] w-[24px] place-items-center rounded-full border border-[#8b72e8] text-[10px] font-bold text-[#7056c9]">{i + 1}</span>
              <h3 className="mt-4 text-[13px] font-bold leading-[1.35] tracking-[-.02em] text-[#1d1a22]">{s.title}</h3>
              <p className="mt-2.5 text-[11px] leading-[1.7] text-[#7f7984]">{s.body}</p>
            </li>
          ))}
        </ol>

        <p className="mt-12 text-[11px] leading-[1.6] text-[#918d96]">
          Runs on test markets. You approve every rule in your own wallet, and nothing moves until you do.
        </p>
      </div>
    </section>
  );
}
