const MAP = {
  armed: "text-warn bg-warnSoft",
  waiting: "text-accentDeep bg-accentSoft",
  triggered: "text-ok bg-okSoft",
  skipped: "text-faint bg-line/60",
};
export default function Chip({ tone = "armed", children }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${MAP[tone]}`}>{children}</span>;
}
