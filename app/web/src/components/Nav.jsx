import { shortAccount } from "../hooks/useWallet.js";

// The logo is the way back to the public page, always, from every screen. The
// product's own sections sit beside it and are only offered once connected.
export default function Nav({ connected, wallet, view, onLanding, onHome, onBuild, onDetails, onWallet }) {
  const item = (active) =>
    `transition hover:text-black ${active ? "text-black" : ""}`;

  return (
    <header className="relative z-20">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between px-7 py-7 sm:px-12 lg:px-16">
        <button onClick={onLanding} className="group flex items-center gap-2.5" aria-label="Sequence home page">
          <div className="relative h-7 w-6">
            <span className="absolute left-0 top-0 h-3.5 w-3.5 rounded-full bg-[#50D6ED] transition group-hover:-translate-y-0.5" />
            <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-[#9B7BFF] transition group-hover:translate-y-0.5" />
          </div>
          <span className="text-[19px] font-bold tracking-[-0.04em] text-[#141221]">Sequence</span>
        </button>

        <nav className="hidden items-center gap-9 text-[12px] font-semibold text-[#585561] md:flex" aria-label="Main">
          {connected ? (
            <>
              <button onClick={onHome} className={item(view === "home")} aria-current={view === "home" ? "page" : undefined}>Your sequences</button>
              <button onClick={onBuild} className={item(view === "build")} aria-current={view === "build" ? "page" : undefined}>Build</button>
              <button onClick={onDetails} className={item(view === "details")} aria-current={view === "details" ? "page" : undefined}>Onchain details</button>
            </>
          ) : (
            <a href="#how-it-works" className="transition hover:text-black">How it works</a>
          )}
        </nav>

        <button
          onClick={onWallet}
          className="rounded-full border border-[#18171d] bg-white px-5 py-2 text-[11px] font-semibold text-[#18171d] transition hover:bg-[#18171d] hover:text-white"
        >
          {connected ? shortAccount(wallet.account) : "Connect wallet"}
        </button>
      </div>

      {/* The row above is hidden on small screens, which would leave a connected
          phone with no way between screens at all. */}
      {connected && (
        <nav className="mobile-nav md:hidden" aria-label="Main, compact">
          <button onClick={onHome} className={`mobile-nav-item ${view === "home" ? "is-active" : ""}`} aria-current={view === "home" ? "page" : undefined}>Your sequences</button>
          <button onClick={onBuild} className={`mobile-nav-item ${view === "build" ? "is-active" : ""}`} aria-current={view === "build" ? "page" : undefined}>Build</button>
          <button onClick={onDetails} className={`mobile-nav-item ${view === "details" ? "is-active" : ""}`} aria-current={view === "details" ? "page" : undefined}>Onchain</button>
        </nav>
      )}
    </header>
  );
}
