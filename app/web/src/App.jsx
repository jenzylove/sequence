import { useState } from "react";
import Nav from "./components/Nav.jsx";
import Hero from "./components/Hero.jsx";
import Builder from "./components/Builder.jsx";
import Operations from "./components/Operations.jsx";

export default function App() {
  const [walletConnected, setWalletConnected] = useState(false);
  const toBuild = () => document.getElementById("build")?.scrollIntoView({ behavior: "smooth" });
  return (
    <div className="min-h-screen bg-paper font-sans text-ink">
      <div className="landing-shell">
        <Nav onBuild={toBuild} walletConnected={walletConnected} onWallet={() => setWalletConnected((connected) => !connected)} />
        <Hero onBuild={toBuild} />
      </div>
      <Builder />
      <Operations walletConnected={walletConnected} onWallet={() => setWalletConnected((connected) => !connected)} />
    </div>
  );
}
