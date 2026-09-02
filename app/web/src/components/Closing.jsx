export default function Closing({ onBuild, onWallet, connected }) {
  return (
    <>
      <section className="closing-shell">
        <div className="relative mx-auto max-w-[1280px] overflow-hidden px-7 py-24 text-center sm:px-12 lg:px-16 lg:py-32">
          <div className="absolute left-[10%] top-[24%] h-16 w-16 dotted-coral opacity-45" />
          <div className="absolute bottom-[12%] right-[12%] h-24 w-32 bg-[#c6f3f7] opacity-70 [clip-path:polygon(16%_0,100%_14%,86%_100%,0_82%)]" />
          <span className="section-tag bg-[#8b72e8]">Sequence</span>
          <h2 className="mx-auto mt-6 max-w-[720px] text-[42px] font-extrabold leading-[1.02] tracking-[-0.058em] text-[#0b0a0e] sm:text-[58px]">Make the decision once.<br />Let the outcome move it forward.</h2>
          <p className="mx-auto mt-6 max-w-[470px] text-[13px] leading-[1.75] text-[#6f6a74]">Describe it, see exactly what it will do, then put it live only when it reads the way you meant it.</p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <button onClick={onBuild} className="soft-button bg-[#111014] px-6 py-3 text-white">Start a sequence</button>
            <button onClick={onWallet} className="soft-button border border-[#d9d4de] bg-white px-6 py-3 text-[#28252c]">{connected ? "View wallet" : "Connect wallet"}</button>
          </div>
        </div>
      </section>
      <Footer onBuild={onBuild} />
    </>
  );
}

function Footer({ onBuild }) {
  return (
    <footer className="site-footer">
      <div className="mx-auto grid max-w-[1280px] gap-12 px-7 py-14 sm:px-12 md:grid-cols-[1.4fr_1fr_1fr] lg:px-16">
        <div>
          <a href="#top" className="inline-flex items-center gap-2.5"><span className="relative h-7 w-6"><i className="absolute left-0 top-0 h-3.5 w-3.5 rounded-full bg-[#50D6ED]" /><i className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-[#9B7BFF]" /></span><span className="text-[18px] font-bold tracking-[-.04em]">Sequence</span></a>
          <p className="mt-5 max-w-[280px] text-[10px] leading-5 text-[#8e8993]">Your next trade, placed the moment the market settles. Never more than the limits you set.</p>
          <div className="mt-5 inline-flex items-center gap-2 text-[9px] font-semibold text-[#77717d]"><span className="h-1.5 w-1.5 rounded-full bg-[#55b58a]" />Shannon testnet</div>
        </div>
        <FooterGroup title="Product"><button onClick={onBuild}>Build a sequence</button><a href="#how-it-works">How it works</a></FooterGroup>
        <FooterGroup title="Technical"><a href="https://github.com/jenzylove/sequence/blob/main/docs/VERIFIED.md" target="_blank" rel="noreferrer">How it is wired ↗</a><a href="https://github.com/jenzylove/sequence" target="_blank" rel="noreferrer">GitHub ↗</a><a href="#top">Back to top</a></FooterGroup>
      </div>
      <div className="mx-auto flex max-w-[1152px] flex-wrap justify-between gap-3 border-t border-[#2b2930] px-7 py-5 text-[8px] uppercase tracking-[.12em] text-[#6e6973] sm:px-12"><span>Sequence · 2026</span><span>Decide once · settles · trades</span></div>
    </footer>
  );
}

function FooterGroup({ title, children }) { return <div><h3 className="text-[9px] font-bold uppercase tracking-[.14em] text-[#706b75]">{title}</h3><div className="mt-5 flex flex-col items-start gap-3 text-[10px] text-[#b3afb6]">{children}</div></div>; }
