import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "./components/BrandMark.js";
import { CommandsView } from "./components/CommandsView.js";
import { ExampleView } from "./components/ExampleView.js";
import { MemoryView } from "./components/MemoryView.js";
import { PrivacyView } from "./components/PrivacyView.js";
import { ReceiptView } from "./components/ReceiptView.js";
import { Sidebar } from "./components/Sidebar.js";
import { StartView } from "./components/StartView.js";
import { sampleSignal } from "./data/sampleSignal.js";
import { useDemoSettings } from "./state/useDemoSettings.js";
import { type AppView, viewFromHash } from "./views.js";

export function App() {
  const [view, setView] = useState<AppView>(() => viewFromHash());
  const [menuOpen, setMenuOpen] = useState(false);
  const skipInitialFocus = useRef(true);
  const { settings, updateSettings, resetSettings } = useDemoSettings();

  useEffect(() => {
    const sync = () => {
      const next = viewFromHash();
      setView(next);
      const current = window.location.hash.replace(/^#/, "").trim().toLowerCase();
      if (current !== next) {
        window.history.replaceState(null, "", `#${next}`);
      }
    };
    window.addEventListener("hashchange", sync);
    sync();
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    if (skipInitialFocus.current) {
      skipInitialFocus.current = false;
      return;
    }
    const main = document.getElementById("main-content");
    main?.focus({ preventScroll: true });
  }, [view]);

  const navigate = (next: AppView) => {
    window.location.hash = next;
    setView(next);
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="masthead">
        <button
          type="button"
          className="brand-button"
          onClick={() => navigate("start")}
        >
          <BrandMark />
        </button>
        <p className="connection-state connection-state--verified">
          <i aria-hidden="true" />
          <span>
            <strong>Always on</strong>
            <small>Text anytime from iMessage</small>
          </span>
        </p>
        <button
          type="button"
          className="mobile-menu-button"
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
          <span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>
        </button>
      </header>

      <div className={`workspace${menuOpen ? " workspace--menu-open" : ""}`}>
        {menuOpen ? (
          <button
            type="button"
            className="mobile-scrim"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
        ) : null}
        <Sidebar view={view} onNavigate={navigate} />
        {view === "start" ? (
          <StartView
            onOpenExample={() => navigate("example")}
            onOpenCommands={() => navigate("commands")}
          />
        ) : null}
        {view === "example" ? (
          <ExampleView onOpenSources={() => navigate("receipt")} />
        ) : null}
        {view === "commands" ? <CommandsView /> : null}
        {view === "receipt" ? (
          <ReceiptView
            signal={sampleSignal}
            settings={settings}
            onBack={() => navigate("example")}
            onUpdateSettings={updateSettings}
          />
        ) : null}
        {view === "memory" ? (
          <MemoryView settings={settings} onUpdateSettings={updateSettings} />
        ) : null}
        {view === "privacy" ? (
          <PrivacyView
            settings={settings}
            onUpdateSettings={updateSettings}
            onReset={resetSettings}
          />
        ) : null}
      </div>
    </div>
  );
}
