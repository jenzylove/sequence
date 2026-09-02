import Nav from "./components/Nav.jsx";
import Hero from "./components/Hero.jsx";
import Builder from "./components/Builder.jsx";

export default function App() {
  const toBuild = () => document.getElementById("build")?.scrollIntoView({ behavior: "smooth" });
  return (
    <div className="min-h-screen bg-paper font-sans text-ink">
      <div className="landing-shell">
        <Nav onBuild={toBuild} />
        <Hero onBuild={toBuild} />
      </div>
      <Builder />
    </div>
  );
}
