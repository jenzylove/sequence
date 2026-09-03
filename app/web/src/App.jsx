import { useEffect, useState } from "react";
import Nav from "./components/Nav.jsx";
import Hero from "./components/Hero.jsx";
import HowItWorks from "./components/HowItWorks.jsx";
import Dashboard from "./components/Dashboard.jsx";
import Builder from "./components/Builder.jsx";
import Operations from "./components/Operations.jsx";
import Closing from "./components/Closing.jsx";
import WalletDialog from "./components/WalletDialog.jsx";
import { useWallet } from "./hooks/useWallet.js";
import { useMarkets } from "./hooks/useMarkets.js";
import { useVault } from "./hooks/useVault.js";

// Four screens, exactly one on at a time.
//
//   landing  the public page. Always reachable, connected or not, via the logo.
//   home     Your sequences: what is live, drafted and finished.
//   build    the creation flow, and the only place a sequence is made.
//   details  the raw onchain record.
//
// Navigation rules that came out of walking this as a new trader:
//   - the logo always returns to the landing page and never anywhere else
//   - connecting a wallet never moves the user on its own; only a gated action
//     they asked for does, and then only to the screen that action implied
//   - leaving the builder returns to home, which is where sequences live
const VIEWS = ["landing", "home", "build", "details"];

export default function App() {
  const [view, setView] = useState("landing");
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletReason, setWalletReason] = useState(null);
  const [pendingView, setPendingView] = useState(null);
  const [editing, setEditing] = useState(null);

  const wallet = useWallet();
  const markets = useMarkets();
  const vault = useVault();
  const connected = wallet.connected;

  const show = (next) => {
    if (!VIEWS.includes(next)) return;
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Asking for a wallet always records WHY. Without a reason the user simply
  // stays where they are once connected.
  const askToConnect = (reason = null, thenGo = null) => {
    setWalletReason(reason);
    setPendingView(thenGo);
    setWalletOpen(true);
  };

  const startBuilding = (draft = null) => {
    setEditing(draft);
    if (!connected) {
      askToConnect("Connect a wallet to build a sequence. You approve every rule yourself, and nothing moves until you do.", "build");
      return;
    }
    show("build");
  };

  // Disconnecting drops back to the public page, since nothing else can render.
  useEffect(() => { if (!connected && view !== "landing") show("landing"); }, [connected, view]);

  const onLanding = view === "landing";

  return (
    <div id="top" className="min-h-screen bg-paper font-sans text-ink">
      <div className={onLanding ? "landing-shell" : "app-shell"}>
        <Nav
          connected={connected}
          wallet={wallet}
          view={view}
          onLanding={() => show("landing")}
          onHome={() => (connected ? show("home") : askToConnect("Connect a wallet to see your sequences.", "home"))}
          onBuild={() => startBuilding()}
          onDetails={() => (connected ? show("details") : askToConnect("Connect a wallet to see the onchain record.", "details"))}
          onWallet={() => askToConnect(null, null)}
        />
        {onLanding && <Hero onBuild={() => startBuilding()} onOperations={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })} />}
      </div>

      {onLanding && <HowItWorks />}

      {view === "home" && (
        <Dashboard
          markets={markets}
          vault={vault}
          wallet={wallet}
          onNewSequence={() => startBuilding()}
          onEditDraft={(draft) => startBuilding(draft)}
          onOpenDetails={() => show("details")}
        />
      )}

      {view === "build" && (
        <Builder
          markets={markets}
          vault={vault}
          wallet={wallet}
          initialDraft={editing}
          onWallet={() => askToConnect(null, null)}
          onExit={() => show("home")}
          onActivated={() => show("home")}
        />
      )}

      {view === "details" && (
        <Operations
          wallet={wallet}
          vault={vault}
          markets={markets}
          onWallet={() => askToConnect(null, null)}
          onBuild={() => startBuilding()}
          onExit={() => show("home")}
        />
      )}

      {onLanding && <Closing onBuild={() => startBuilding()} />}

      <WalletDialog
        open={walletOpen}
        wallet={wallet}
        reason={walletReason}
        // Only a connection that a gated action asked for moves the user, and
        // the intent is consumed here rather than in an effect, so dismissing
        // the dialog can never navigate on its own.
        onConnected={() => {
          const next = pendingView;
          setPendingView(null);
          if (next) window.setTimeout(() => show(next), 60);
        }}
        onClose={() => { setWalletOpen(false); setWalletReason(null); setPendingView(null); }}
      />
    </div>
  );
}
