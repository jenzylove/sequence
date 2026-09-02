import { useEffect, useState } from "react";
import Nav from "./components/Nav.jsx";
import Hero from "./components/Hero.jsx";
import Dashboard from "./components/Dashboard.jsx";
import Builder from "./components/Builder.jsx";
import Operations from "./components/Operations.jsx";
import Closing from "./components/Closing.jsx";
import WalletDialog from "./components/WalletDialog.jsx";
import { useWallet } from "./hooks/useWallet.js";
import { useMarkets } from "./hooks/useMarkets.js";
import { useVault } from "./hooks/useVault.js";

// Two surfaces. Before connecting, the landing explains the product and lets a
// visitor build and simulate for free. After connecting, the desk takes over:
// what is running, what it waits on, what it costs. The manual builder and the
// raw onchain view stay one click away as the advanced surfaces.
export default function App() {
  const [walletOpen, setWalletOpen] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [editing, setEditing] = useState(null);

  const wallet = useWallet();
  const markets = useMarkets();
  const vault = useVault();
  const connected = wallet.connected;

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  const openBuilder = (draft = null) => {
    setEditing(draft);
    setShowBuilder(true);
    window.setTimeout(() => scrollTo("build"), 60);
  };
  const openDetails = () => {
    setShowDetails(true);
    window.setTimeout(() => scrollTo("onchain"), 60);
  };

  // A visitor who has not connected still gets the builder, so they can try the
  // product before committing anything.
  useEffect(() => { if (!connected) setShowBuilder(true); }, [connected]);

  return (
    <div id="top" className="min-h-screen bg-paper font-sans text-ink">
      <div className="landing-shell">
        <Nav
          connected={connected}
          wallet={wallet}
          onWallet={() => setWalletOpen(true)}
          onDashboard={() => scrollTo(connected ? "dashboard" : "build")}
          onBuilder={() => openBuilder()}
          onDetails={openDetails}
        />
        {!connected && <Hero onBuild={() => scrollTo("build")} onOperations={() => setWalletOpen(true)} />}
      </div>

      {connected && (
        <Dashboard
          markets={markets}
          vault={vault}
          wallet={wallet}
          onOpenBuilder={() => openBuilder()}
          onEditDraft={(draft) => openBuilder(draft)}
          onOpenDetails={openDetails}
        />
      )}

      {showBuilder && (
        <Builder
          markets={markets}
          vault={vault}
          wallet={wallet}
          initialDraft={editing}
          advanced={connected}
          onWallet={() => setWalletOpen(true)}
          onClose={connected ? () => setShowBuilder(false) : null}
        />
      )}

      {connected && !showDetails && (
        <div className="details-shell">
          <div className="mx-auto max-w-[1280px] px-7 py-10 text-center sm:px-12 lg:px-16">
            <button onClick={openDetails} className="details-toggle">Onchain details and proof →</button>
          </div>
        </div>
      )}

      {(showDetails || !connected) && (
        <Operations
          wallet={wallet}
          vault={vault}
          markets={markets}
          onWallet={() => setWalletOpen(true)}
          onBuild={() => openBuilder()}
        />
      )}

      <Closing onBuild={() => (connected ? scrollTo("dashboard") : openBuilder())} onWallet={() => setWalletOpen(true)} connected={connected} />
      <WalletDialog open={walletOpen} wallet={wallet} onClose={() => setWalletOpen(false)} />
    </div>
  );
}
