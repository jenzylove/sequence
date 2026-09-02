import { useState } from "react";
import Nav from "./components/Nav.jsx";
import Hero from "./components/Hero.jsx";
import Builder from "./components/Builder.jsx";
import Operations from "./components/Operations.jsx";
import Closing from "./components/Closing.jsx";
import WalletDialog from "./components/WalletDialog.jsx";
import { useWallet } from "./hooks/useWallet.js";

export default function App() {
  const [walletOpen, setWalletOpen] = useState(false);
  const wallet = useWallet();
  const toBuild = () => document.getElementById("build")?.scrollIntoView({ behavior: "smooth" });
  return (
    <div id="top" className="min-h-screen bg-paper font-sans text-ink">
      <div className="landing-shell">
        <Nav onBuild={toBuild} wallet={wallet} onWallet={() => setWalletOpen(true)} />
        <Hero onBuild={toBuild} />
      </div>
      <Builder />
      <Operations wallet={wallet} onWallet={() => setWalletOpen(true)} onBuild={toBuild} />
      <Closing onBuild={toBuild} onWallet={() => setWalletOpen(true)} connected={wallet.connected} />
      <WalletDialog open={walletOpen} wallet={wallet} onClose={() => setWalletOpen(false)} />
    </div>
  );
}
