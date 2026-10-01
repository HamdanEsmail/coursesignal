import { Menu, Smartphone, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BrandMark } from "./components/BrandMark.js";
import { ConnectView } from "./components/ConnectView.js";
import { EvidenceRail } from "./components/EvidenceRail.js";
import { MemoryView } from "./components/MemoryView.js";
import { PrivacyView } from "./components/PrivacyView.js";
import { ReceiptView } from "./components/ReceiptView.js";
import { Sidebar, type ViewId } from "./components/Sidebar.js";
import { SignalView } from "./components/SignalView.js";
import { WatchesView } from "./components/WatchesView.js";
import { sampleSignal } from "./data/sampleSignal.js";
import { useDemoSettings } from "./state/useDemoSettings.js";

const viewIds = new Set<ViewId>(["today", "receipt", "connect", "watches", "memory", "privacy"]);
const viewTitles: Record<ViewId, string> = {
  today: "iMessage demo",
  receipt: "Evidence receipt",
  connect: "Connect iPhone",
  watches: "Watches",
  memory: "Memory",
  privacy: "Privacy",
};

function readHash(): ViewId {
  const value = window.location.hash.slice(1) as ViewId;
  return viewIds.has(value) ? value : "receipt";
}

export function App() {
  const [activeView, setActiveView] = useState<ViewId>(readHash);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { settings, updateSettings, resetSettings } = useDemoSettings();

  useEffect(() => {
    const syncRoute = () => {
      setActiveView(readHash());
      setMobileMenuOpen(false);
    };
    window.addEventListener("hashchange", syncRoute);
    window.addEventListener("popstate", syncRoute);
    return () => {
      window.removeEventListener("hashchange", syncRoute);
      window.removeEventListener("popstate", syncRoute);
    };
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenuOpen]);

  useEffect(() => {
    document.title = `CourseSignal — ${viewTitles[activeView]}`;
  }, [activeView]);

  const navigate = useCallback((view: ViewId) => {
    setActiveView(view);
    setMobileMenuOpen(false);
    if (window.location.hash !== `#${view}`) window.location.hash = view;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    window.setTimeout(() => document.getElementById("main-content")?.focus({ preventScroll: true }), 0);
  }, []);

  let content;
  switch (activeView) {
    case "receipt":
      content = (
        <ReceiptView
          signal={sampleSignal}
          settings={settings}
          onBack={() => navigate("today")}
          onUpdateSettings={updateSettings}
        />
      );
      break;
    case "connect":
      content = <ConnectView />;
      break;
    case "watches":
      content = <WatchesView settings={settings} onUpdateSettings={updateSettings} />;
      break;
    case "memory":
      content = <MemoryView settings={settings} onUpdateSettings={updateSettings} />;
      break;
    case "privacy":
      content = (
        <PrivacyView
          settings={settings}
          onUpdateSettings={updateSettings}
          onReset={resetSettings}
        />
      );
      break;
    default:
      content = (
        <>
          <SignalView signal={sampleSignal} onOpenReceipt={() => navigate("receipt")} />
          <EvidenceRail signal={sampleSignal} />
        </>
      );
  }

  return (
    <div className={`app-shell app-shell--${activeView}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="masthead">
        <button className="brand-button" type="button" onClick={() => navigate("receipt")} aria-label="CourseSignal receipt home">
          <BrandMark />
        </button>
        <div className="connection-state connection-state--verified" aria-label="iMessage transport verified">
          <Smartphone aria-hidden="true" size={20} strokeWidth={1.6} />
          <span>
            <strong>iMessage verified</strong>
            <small>Listener offline between tests</small>
          </span>
          <i aria-hidden="true" />
        </div>
        <div className="masthead__account" aria-label="Fixture preview account">
          <span>Fixture</span>
          <span className="avatar" aria-hidden="true">F</span>
        </div>
        <button
          className="mobile-menu-button"
          type="button"
          aria-expanded={mobileMenuOpen}
          aria-controls="primary-navigation"
          aria-label={mobileMenuOpen ? "Close navigation" : "Open navigation"}
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          {mobileMenuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </header>

      <div className={`workspace workspace--${activeView} ${mobileMenuOpen ? "workspace--menu-open" : ""}`}>
        {mobileMenuOpen ? (
          <button className="mobile-scrim" type="button" aria-label="Close navigation" onClick={() => setMobileMenuOpen(false)} />
        ) : null}
        <div id="primary-navigation">
          <Sidebar active={activeView} onSelect={navigate} />
        </div>
        {content}
      </div>
    </div>
  );
}
