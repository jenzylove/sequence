export default function Nav() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-8 py-4">
        <div className="flex items-center gap-2.5">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-ink">
            <div className="h-3 w-3 rotate-45 rounded-[50%_50%_50%_0] border-2 border-white" />
          </div>
          <span className="text-[18px] font-bold text-ink">Sequence</span>
        </div>
        <nav className="hidden items-center gap-7 md:flex text-[14px] font-medium text-sub">
          <a href="#build" className="hover:text-ink">Builder</a>
          <a href="#" className="hover:text-ink">Strategies</a>
          <a href="#" className="hover:text-ink">Docs</a>
        </nav>
        <button className="rounded-lg border border-line bg-white px-4 py-2 text-[13px] font-medium text-ink hover:border-faint">Connect wallet</button>
      </div>
    </header>
  );
}
