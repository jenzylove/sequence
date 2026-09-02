export default function Nav({ onBuild }) {
  return (
    <header className="relative z-20">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between px-7 py-7 sm:px-12 lg:px-16">
        <button onClick={onBuild} className="group flex items-center gap-2.5" aria-label="Go to Sequence builder">
          <div className="relative h-7 w-6">
            <span className="absolute left-0 top-0 h-3.5 w-3.5 rounded-full bg-[#50D6ED] transition group-hover:-translate-y-0.5" />
            <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full bg-[#9B7BFF] transition group-hover:translate-y-0.5" />
          </div>
          <span className="text-[19px] font-bold tracking-[-0.04em] text-[#141221]">Sequence</span>
        </button>
        <nav className="hidden items-center gap-9 text-[12px] font-semibold text-[#585561] md:flex">
          <a href="#build" className="transition hover:text-black">Builder</a>
          <a href="#how-it-works" className="transition hover:text-black">How it works</a>
          <a href="#proof" className="transition hover:text-black">Proof</a>
        </nav>
        <button className="rounded-full border border-[#18171d] bg-white px-5 py-2 text-[11px] font-semibold text-[#18171d] transition hover:bg-[#18171d] hover:text-white">Connect wallet</button>
      </div>
    </header>
  );
}
