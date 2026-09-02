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

// Two worlds, kept strictly apart.
//
// Disconnected is a landing page and nothing else: what the product does, how it
// works, and one way in. No account state, no balances, no contract addresses.
//
// Connected is the product. "Build your sequence" goes straight to the builder
// rather than parking the user on a dashboard first; the home view with their
// drafts and live sequences is one click away in the nav.
export default function App() {
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletReason, setWalletReason] = useState(null);
  const [view, setView] = useState("home");
  const [editing, setEditing] = useState(null);
  const [intent, setIntent] = useState(null);

  const wallet = useWallet();
  const markets = useMarkets();
  const vault = useVault();
  const connected = wallet.connected;

  const askToConnect = (reason) => { setWalletReason(reason); setWalletOpen(true); };

  // "Build your sequence" is the product's front door. Disconnected, it asks for
  // a wallet and remembers why, so connecting drops the user straight into the
  // builder instead of back where they started.
  const startBuilding = (draft = null) => {
    setEditing(draft);
    if (!connected) {
      setIntent("build");
      askToConnect("Connect a wallet to build a sequence. You approve every rule yourself, and nothing moves until you do.");
      return;
    }
    setView("build");
    window.setTimeout(() => document.getElementById("build")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  useEffect(() => {
    if (!connected) { setView("home"); return; }
    if (intent === "build") {
      setIntent(null);
      setView("build");
      window.setTimeout(() => document.getElementById("build")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    }
  }, [connected, intent]);

  const go = (next) => {
    setView(next);
    const anchor = next === "build" ? "build" : next === "details" ? "onchain" : "dashboard";
    window.setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  return (
    <div id="top" className="min-h-screen bg-paper font-sans text-ink">
      <div className="landing-shell">
        <Nav
          connected={connected}
          wallet={wallet}
          view={view}
          onWallet={() => askToConnect(null)}
          onHome={() => (connected ? go("home") : document.getElementById("top")?.scrollIntoView({ behavior: "smooth" }))}
          onBuild={() => startBuilding()}
          onDetails={() => go("details")}
        />
        {!connected && (
          <Hero
            onBuild={() => startBuilding()}
            onOperations={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })}
          />
        )}
      </div>

      {/* Public: explanation only. No account state reaches this surface. */}
      {!connected && <HowItWorks onStart={() => startBuilding()} />}

      {connected && view === "home" && (
        <Dashboard
          markets={markets}
          vault={vault}
          wallet={wallet}
          onOpenBuilder={() => startBuilding()}
          onEditDraft={(draft) => startBuilding(draft)}
          onOpenDetails={() => go("details")}
        />
      )}

      {connected && view === "build" && (
        <Builder
          markets={markets}
          vault={vault}
          wallet={wallet}
          initialDraft={editing}
          onWallet={() => askToConnect(null)}
          onClose={() => go("home")}
          onActivated={() => go("home")}
        />
      )}

      {connected && view === "details" && (
        <Operations
          wallet={wallet}
          vault={vault}
          markets={markets}
          onWallet={() => askToConnect(null)}
          onBuild={() => startBuilding()}
          onClose={() => go("home")}
        />
      )}

      <Closing
        onBuild={() => startBuilding()}
        onWallet={() => askToConnect(null)}
        connected={connected}
      />

      <WalletDialog
        open={walletOpen}
        wallet={wallet}
        reason={walletReason}
        onClose={() => { setWalletOpen(false); setWalletReason(null); }}
      />
    </div>
  );
}
