#!/usr/bin/env bash
set -euo pipefail
echo ">> scaffolding Vite + React + Tailwind web app in app/web"

mkdir -p app/web/src/lib app/web/src/components

# ---------- package.json ----------
cat > app/web/package.json << 'EOF'
{
  "name": "sequence-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.13",
    "vite": "^5.4.8"
  }
}
EOF

# ---------- vite / tailwind / postcss ----------
cat > app/web/vite.config.js << 'EOF'
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()] });
EOF

cat > app/web/tailwind.config.js << 'EOF'
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0E1526",
        sub: "#5A6474",
        faint: "#98A1B2",
        line: "#E9EDF4",
        paper: "#F7F9FC",
        accent: "#6FA8F5",
        accentDeep: "#2F6FD0",
        accentSoft: "#EAF2FE",
        ok: "#4FB07E",
        okSoft: "#E9F6EF",
        warn: "#E0A93C",
        warnSoft: "#FBF3E2",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
      boxShadow: {
        float: "0 24px 50px -22px rgba(30,55,100,.30)",
        soft: "0 8px 26px -18px rgba(30,55,100,.22)",
      },
    },
  },
  plugins: [],
};
EOF

cat > app/web/postcss.config.js << 'EOF'
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
EOF

# ---------- index.html ----------
cat > app/web/index.html << 'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
    <title>Sequence</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
EOF

# ---------- entry + css ----------
cat > app/web/src/main.jsx << 'EOF'
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
ReactDOM.createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
EOF

cat > app/web/src/index.css << 'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;
html { -webkit-font-smoothing: antialiased; }
body { margin: 0; background: #F7F9FC; }
EOF

# ---------- sim logic (mirror of the vault) ----------
cat > app/web/src/lib/sim.js << 'EOF'
// Mirror of SequenceVault._winner + branch + caps. Keep identical to Solidity.
export const KIND_LABEL = { 0: "Buy YES", 1: "Sell YES", 2: "Buy NO", 3: "Sell NO" };

export function winner(nums, voided) {
  if (voided || nums.length === 0 || nums.length > 2) return 255;
  let maxv = 0n;
  for (const n of nums) if (n > maxv) maxv = n;
  if (maxv === 0n) return 255;
  let idx = 255, count = 0;
  nums.forEach((n, i) => { if (n === maxv) { count++; idx = i; } });
  return count === 1 ? idx : 255;
}
export function kindFor(win, buyYesOnWin0) {
  if (win === 255) return null;
  if (win === 0) return buyYesOnWin0 ? 0 : 2;
  return buyYesOnWin0 ? 2 : 0;
}
export function simulate(strat, resolutions) {
  const events = []; const consumed = new Set(); let outstanding = 0n;
  const byMarket = {};
  for (const s of strat.steps) byMarket[s.triggerMarketId.toLowerCase()] = s;
  for (const r of resolutions) {
    const ck = r.marketId.toLowerCase() + ":" + r.questionId;
    if (consumed.has(ck)) continue; consumed.add(ck);
    const step = byMarket[r.marketId.toLowerCase()];
    if (!step) continue;
    const win = winner(r.payoutNumerators, r.voided);
    const kind = kindFor(win, step.buyYesOnWin0);
    if (kind === null) { events.push({ stepId: step.id, action: "SKIPPED", reason: r.voided ? "voided" : "no clean winner" }); continue; }
    const n = step.price * step.quantity;
    if (n > step.notionalCap) { events.push({ stepId: step.id, action: "SKIPPED", reason: "step cap" }); continue; }
    if (outstanding + n > strat.maxOutstanding) { events.push({ stepId: step.id, action: "SKIPPED", reason: "vault cap" }); continue; }
    outstanding += n;
    events.push({ stepId: step.id, action: "EXECUTED", kind, notional: n });
  }
  return { events, committed: outstanding };
}
export const fmt = (raw) => "$" + (Number(raw) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 });
EOF

# ---------- shared UI bits ----------
cat > app/web/src/components/Chip.jsx << 'EOF'
const MAP = {
  armed: "text-warn bg-warnSoft",
  waiting: "text-accentDeep bg-accentSoft",
  triggered: "text-ok bg-okSoft",
  skipped: "text-faint bg-line/60",
};
export default function Chip({ tone = "armed", children }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${MAP[tone]}`}>{children}</span>;
}
EOF

# ---------- Hero (SmartList/Quso composition, done in Tailwind) ----------
cat > app/web/src/components/Hero.jsx << 'EOF'
import Chip from "./Chip.jsx";

// SmartList-style: bold headline + subtext + single CTA on the left; a cluster of
// real Sequence state panels on the right, connected by thin curved rails.
export default function Hero({ onBuild }) {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto max-w-6xl px-8 pt-20 pb-24 grid grid-cols-1 lg:grid-cols-[minmax(0,480px)_1fr] gap-12 items-center">
        {/* left */}
        <div>
          <h1 className="text-[46px] leading-[1.05] font-extrabold tracking-[-0.03em] text-ink">
            Set the next trade<br />before this one <span className="text-accentDeep">settles.</span>
          </h1>
          <p className="mt-6 text-[17px] leading-relaxed text-sub max-w-[440px]">
            Choose what Sequence should do after each outcome — enter the next DreamDEX market, change size, or stop. Settlement triggers the next step automatically.
          </p>
          <div className="mt-8">
            <button onClick={onBuild}
              className="rounded-xl bg-ink px-6 py-3.5 text-[15px] font-semibold text-white shadow-[0_12px_28px_-12px_rgba(14,21,38,.55)] transition hover:-translate-y-0.5">
              Build a Sequence
            </button>
          </div>
          <p className="mt-7 font-mono text-[12.5px] text-faint">
            DreamDEX settlement → Somnia Reactivity → next bounded order
          </p>
        </div>

        {/* right: floating panels + rails */}
        <div className="relative h-[440px] hidden lg:block">
          <svg className="absolute inset-0 h-full w-full" aria-hidden>
            <path d="M 120 96 C 210 140, 220 210, 300 232" fill="none" stroke="#BFD4F4" strokeWidth="1.6" strokeDasharray="1 7" strokeLinecap="round" />
            <path d="M 330 250 C 300 320, 220 330, 175 360" fill="none" stroke="#BFD4F4" strokeWidth="1.6" strokeDasharray="1 7" strokeLinecap="round" />
          </svg>

          {/* current market */}
          <div className="absolute left-0 top-8 w-[236px] rounded-2xl border border-line bg-white p-4 shadow-float">
            <div className="text-[11px] text-faint">Current market</div>
            <div className="mt-1 font-semibold text-[15px] text-ink">BTC above $61,500?</div>
            <div className="mt-1.5 font-mono text-[11px] text-faint">DreamDEX · 02SEP 13:45</div>
            <div className="mt-3 flex items-center justify-between">
              <Chip tone="waiting">Settling soon</Chip>
              <span className="font-mono text-[11px] text-sub">held $2.00</span>
            </div>
          </div>

          {/* next order */}
          <div className="absolute right-2 top-[188px] w-[224px] rounded-2xl border border-accent bg-white p-4 shadow-float ring-4 ring-accentSoft">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[15px] text-ink">Buy YES</span>
              <Chip tone="armed">Armed</Chip>
            </div>
            <div className="mt-1.5 font-mono text-[11px] text-faint">ETH · 02SEP 14:00</div>
            <div className="mt-3 flex justify-between text-[12.5px] text-sub">
              <span>size <b className="font-mono text-ink">$3.00</b></span>
              <span>cap <b className="font-mono text-ink">$4.00</b></span>
            </div>
          </div>

          {/* branch */}
          <div className="absolute left-6 bottom-2 w-[210px] rounded-2xl border border-line bg-white p-4 shadow-soft">
            <div className="text-[11px] text-faint mb-2">On settlement</div>
            <div className="space-y-1.5 text-[12.5px]">
              <div className="flex justify-between"><span className="font-medium text-ok">YES wins</span><span className="text-sub">→ continue</span></div>
              <div className="flex justify-between"><span className="font-medium text-ink">NO wins</span><span className="text-sub">→ resize</span></div>
              <div className="flex justify-between"><span className="font-medium text-faint">Void</span><span className="text-sub">→ stop</span></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
EOF

# ---------- Builder (chain + editor + sim) ----------
cat > app/web/src/components/Builder.jsx << 'EOF'
import { useMemo, useState } from "react";
import Chip from "./Chip.jsx";
import { simulate, fmt, KIND_LABEL } from "../lib/sim.js";

const seed = () => ([
  { id: "step1", label: "BTC · 02SEP 13:45", triggerMarketId: "0x00…f920", pool: "0xPOOL-btc", price: 600000n, quantity: 5n, buyYesOnWin0: true, notionalCap: 4000000n },
  { id: "step2", label: "ETH · 02SEP 14:00", triggerMarketId: "0x00…f921", pool: "0xPOOL-eth", price: 480000n, quantity: 6n, buyYesOnWin0: false, notionalCap: 3500000n },
]);

export default function Builder() {
  const [steps, setSteps] = useState(seed);
  const [maxOutstanding, setMaxOutstanding] = useState(5000000n);
  const bankroll = 10000000n;
  const [selected, setSelected] = useState("step1");
  const [ran, setRan] = useState(null);

  const strat = useMemo(() => ({ steps, maxOutstanding, bankroll }), [steps, maxOutstanding]);
  const errors = useMemo(() => {
    const e = [];
    if (maxOutstanding > bankroll) e.push("Vault cap is higher than the bankroll.");
    for (const s of steps) {
      if (s.price <= 0n || s.quantity <= 0n) e.push(`${s.id}: price and size must be above zero.`);
      if (s.price * s.quantity > s.notionalCap) e.push(`${s.id}: order value ${fmt(s.price * s.quantity)} is over its cap ${fmt(s.notionalCap)}.`);
    }
    return e;
  }, [steps, maxOutstanding]);

  const sel = steps.find((s) => s.id === selected);
  const update = (id, patch) => setSteps((p) => p.map((s) => s.id === id ? { ...s, ...patch } : s));
  const addStep = () => {
    const id = "step" + (steps.length + 1);
    setSteps((p) => [...p, { id, label: "New market", triggerMarketId: "0x00…0000", pool: "0xPOOL", price: 500000n, quantity: 4n, buyYesOnWin0: true, notionalCap: 3000000n }]);
    setSelected(id);
  };
  const removeStep = (id) => { setSteps((p) => p.filter((s) => s.id !== id)); if (selected === id) setSelected(steps[0].id); };
  const runSim = () => {
    const res = steps.map((s, i) => i === 1
      ? { marketId: s.triggerMarketId, questionId: 2, payoutNumerators: [0n, 0n], voided: true }
      : { marketId: s.triggerMarketId, questionId: i + 1, payoutNumerators: [1n, 0n], voided: false });
    setRan(simulate(strat, res));
  };
  const evFor = (id) => ran?.events.find((e) => e.stepId === id);
  const tone = (id) => { const e = evFor(id); return !e ? "armed" : e.action === "EXECUTED" ? "triggered" : "skipped"; };
  const label = (id) => { const e = evFor(id); return !e ? "Armed" : e.action === "EXECUTED" ? "Triggered" : "Skipped"; };

  return (
    <section id="build" className="border-t border-line bg-white">
      <div className="mx-auto max-w-6xl px-8 py-14">
        <h2 className="text-2xl font-bold tracking-[-0.02em] text-ink">Build your sequence</h2>
        <p className="mt-1.5 text-[15px] text-sub">Chain bounded orders to real settlements. Simulate before you arm.</p>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-[330px_1fr] gap-7">
          {/* chain */}
          <div>
            <div className="text-[13px] font-medium text-faint mb-3.5">Strategy chain</div>
            {steps.map((s, i) => {
              const e = evFor(s.id);
              const dot = e ? (e.action === "EXECUTED" ? "border-ok" : "border-faint") : "border-accent";
              return (
                <div key={s.id} className="relative pl-8 mb-3.5">
                  {i < steps.length - 1 && <div className="absolute left-[9px] top-[30px] -bottom-3.5 w-0.5 bg-line" />}
                  <div className={`absolute left-0.5 top-[18px] h-4 w-4 rounded-full border-2 bg-white ${dot}`} />
                  <button onClick={() => setSelected(s.id)}
                    className={`w-full text-left rounded-xl border bg-white p-3.5 transition ${selected === s.id ? "border-accent ring-4 ring-accentSoft" : "border-line shadow-soft hover:border-accent"}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[14px] text-ink">{s.label}</span>
                      <Chip tone={tone(s.id)}>{label(s.id)}</Chip>
                    </div>
                    <div className="mt-2 text-[12.5px] text-sub">outcome 0 wins → <b className="text-ink">{s.buyYesOnWin0 ? "Buy YES" : "Buy NO"}</b></div>
                    <div className="mt-1.5 font-mono text-[11px] text-faint">{fmt(s.price * s.quantity)} · cap {fmt(s.notionalCap)}</div>
                    {e?.reason && <div className="mt-1.5 text-[11.5px] text-faint">skipped: {e.reason}</div>}
                    {e?.action === "EXECUTED" && <div className="mt-1.5 text-[11.5px] font-medium text-ok">{KIND_LABEL[e.kind]} placed · {fmt(e.notional)}</div>}
                  </button>
                </div>
              );
            })}
            <button onClick={addStep} className="w-full rounded-lg border border-line bg-white px-4 py-2.5 text-[13px] font-medium text-ink transition hover:border-faint">+ Add step</button>
          </div>

          {/* editor + sim */}
          <div>
            {sel && (
              <div className="rounded-2xl border border-line bg-paper p-5 mb-5">
                <div className="flex items-center justify-between mb-4">
                  <span className="font-semibold text-ink">Edit step</span>
                  {steps.length > 1 && <button onClick={() => removeStep(sel.id)} className="rounded-lg border border-line bg-white px-3.5 py-2 text-[13px] hover:border-faint">Remove</button>}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Market label"><input className="in" value={sel.label} onChange={(e) => update(sel.id, { label: e.target.value })} /></Field>
                  <Field label="Trigger market id"><input className="in font-mono" value={sel.triggerMarketId} onChange={(e) => update(sel.id, { triggerMarketId: e.target.value })} /></Field>
                  <Field label="Limit price ($)"><input className="in font-mono" type="number" value={Number(sel.price)/1e6} onChange={(e) => update(sel.id, { price: BigInt(Math.round(Number(e.target.value)*1e6)) })} /></Field>
                  <Field label="Size (contracts)"><input className="in font-mono" type="number" value={Number(sel.quantity)} onChange={(e) => update(sel.id, { quantity: BigInt(Math.max(0, Math.round(Number(e.target.value)))) })} /></Field>
                  <Field label="Step cap ($)"><input className="in font-mono" type="number" value={Number(sel.notionalCap)/1e6} onChange={(e) => update(sel.id, { notionalCap: BigInt(Math.round(Number(e.target.value)*1e6)) })} /></Field>
                  <Field label="Branch"><select className="in" value={sel.buyYesOnWin0 ? "yes" : "no"} onChange={(e) => update(sel.id, { buyYesOnWin0: e.target.value === "yes" })}><option value="yes">Outcome 0 wins → Buy YES</option><option value="no">Outcome 0 wins → Buy NO</option></select></Field>
                </div>
                <div className="mt-3.5 text-[12.5px] text-sub">Order value <span className={`font-mono font-medium ${sel.price*sel.quantity > sel.notionalCap ? "text-red-500" : "text-ink"}`}>{fmt(sel.price*sel.quantity)}</span> of {fmt(sel.notionalCap)} cap</div>
              </div>
            )}

            <div className="rounded-2xl border border-line bg-white p-5 shadow-soft">
              <div className="flex items-center justify-between mb-4">
                <span className="font-semibold text-ink">Simulation</span>
                <div className="flex items-center gap-3">
                  <span className="text-[12.5px] text-sub">Vault cap</span>
                  <input className="in font-mono w-[88px]" type="number" value={Number(maxOutstanding)/1e6} onChange={(e) => setMaxOutstanding(BigInt(Math.round(Number(e.target.value)*1e6)))} />
                  <button disabled={errors.length>0} onClick={runSim}
                    className="rounded-lg bg-ink px-4 py-2.5 text-[14px] font-semibold text-white transition enabled:hover:-translate-y-0.5 disabled:opacity-40">Run simulation</button>
                </div>
              </div>
              {errors.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-[12.5px] text-red-600 space-y-0.5">
                  {errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}
              {!ran && errors.length === 0 && (
                <p className="py-3.5 text-[13.5px] leading-relaxed text-sub">Replays your chain against a sample stream — first step settles with a winner, second voids — using the same branch and cap rules the on-chain vault enforces. No funds move.</p>
              )}
              {ran && (
                <div>
                  <div className="mb-4 flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-line/60">
                      <div className="h-full bg-accent" style={{ width: Math.min(100, Number(ran.committed)/Number(maxOutstanding)*100) + "%" }} />
                    </div>
                    <span className="font-mono text-[12px] text-sub">{fmt(ran.committed)} / {fmt(maxOutstanding)}</span>
                  </div>
                  {ran.events.map((e, i) => (
                    <div key={i} className={`flex items-center justify-between py-2.5 ${i < ran.events.length-1 ? "border-b border-line" : ""}`}>
                      <span className="text-[13px] text-ink">{steps.find(s => s.id === e.stepId)?.label || e.stepId}</span>
                      {e.action === "EXECUTED"
                        ? <span className="text-[12.5px] font-medium text-ok">{KIND_LABEL[e.kind]} · {fmt(e.notional)}</span>
                        : <span className="text-[12.5px] text-faint">skipped · {e.reason}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }) {
  return <label className="block"><div className="mb-1.5 text-[12px] font-medium text-sub">{label}</div>{children}</label>;
}
EOF

# ---------- Nav + App ----------
cat > app/web/src/components/Nav.jsx << 'EOF'
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
EOF

cat > app/web/src/App.jsx << 'EOF'
import Nav from "./components/Nav.jsx";
import Hero from "./components/Hero.jsx";
import Builder from "./components/Builder.jsx";

export default function App() {
  const toBuild = () => document.getElementById("build")?.scrollIntoView({ behavior: "smooth" });
  return (
    <div className="min-h-screen bg-paper font-sans text-ink">
      <Nav />
      <Hero onBuild={toBuild} />
      <Builder />
    </div>
  );
}
EOF

# input utility class
cat >> app/web/src/index.css << 'EOF'
@layer components {
  .in { @apply w-full box-border rounded-lg border border-line bg-white px-2.5 py-2 text-[13px] text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accentSoft; }
}
EOF

echo ""
echo ">> installing (this takes a minute)"
cd app/web
npm install >/dev/null 2>&1 && echo "installed."
echo ""
echo ">> verify: build it"
npm run build
