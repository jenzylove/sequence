// Every product screen opens the same way: where you are, what this screen is
// for, and the way back. Used by home, build and the onchain record so a user
// never has to infer their location from the content.
export default function ScreenHeader({ trail, tag, tagColor = "#8b72e8", title, blurb, back, backLabel = "Back", actions }) {
  return (
    <div className="screen-header">
      <div className={`flex flex-wrap items-center gap-4 ${trail.length > 1 || back ? "justify-between" : "justify-end"}`}>
        {/* A single crumb would only repeat the tag directly beneath it. */}
        <nav className={`flex items-center gap-2 text-[10px] font-semibold text-[#a19ca5] ${trail.length > 1 ? "" : "sr-only"}`} aria-label="Breadcrumb">
          {trail.map((crumb, i) => (
            <span key={crumb.label} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden="true">/</span>}
              {crumb.onClick
                ? <button onClick={crumb.onClick} className="transition hover:text-[#28252c]">{crumb.label}</button>
                : <span className="text-[#6c6771]">{crumb.label}</span>}
            </span>
          ))}
        </nav>
        {back && (
          <button onClick={back} className="text-[10px] font-semibold text-[#8f8994] transition hover:text-[#242128]">
            ← {backLabel}
          </button>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
        <div>
          {tag && <span className="section-tag" style={{ background: tagColor }}>{tag}</span>}
          <h2 className="mt-5 max-w-[620px] text-[36px] font-extrabold leading-[1.05] tracking-[-0.055em] text-[#0b0a0e] sm:text-[44px]">{title}</h2>
          {blurb && <p className="mt-4 max-w-[520px] text-[13px] leading-[1.75] text-[#65616b]">{blurb}</p>}
        </div>
        {actions}
      </div>
    </div>
  );
}
