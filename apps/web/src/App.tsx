import { useEffect, useRef, useState } from "react";
import { BrandMark } from "./components/BrandMark.js";
import { CubbyWall } from "./components/CubbyWall.js";
import { ArriveCubby } from "./cubbies/ArriveCubby.js";
import { DemoCubby } from "./cubbies/DemoCubby.js";
import { DeskCubby } from "./cubbies/DeskCubby.js";
import { JudgeCubby } from "./cubbies/JudgeCubby.js";
import { RolesCubby } from "./cubbies/RolesCubby.js";
import { RulesCubby } from "./cubbies/RulesCubby.js";
import { RunCubby } from "./cubbies/RunCubby.js";
import { TextCubby } from "./cubbies/TextCubby.js";
import { cubbies, type AppView, viewFromHash } from "./views.js";

export function App() {
  const [view, setView] = useState<AppView>(() => viewFromHash());
  const skipInitialFocus = useRef(true);

  useEffect(() => {
    const sync = () => {
      const next = viewFromHash();
      setView(next);
      if (window.location.hash.replace(/^#/, "").trim().toLowerCase() !== next) {
        window.history.replaceState(null, "", `#${next}`);
      }
    };
    window.addEventListener("hashchange", sync);
    sync();
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  useEffect(() => {
    if (skipInitialFocus.current) {
      skipInitialFocus.current = false;
      return;
    }
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [view]);

  const navigate = (next: AppView) => {
    window.location.hash = next;
    setView(next);
  };

  const openLabel = cubbies.find((cubby) => cubby.id === view)?.label ?? "Arrive";

  return (
    <div className="lodge">
      <a className="skip-link" href="#main-content">
        Skip to slip
      </a>
      <header className="lodge-rail">
        <BrandMark href="#arrive" />
        <p className="lodge-rail__aside">Dusk · iMessage friend</p>
      </header>
      <div className="lodge-stage">
        <CubbyWall view={view} onNavigate={navigate} />
        <div className="desk-well">
          <p className="desk-well__hole">Pulled from {openLabel}</p>
          <main className="paper-sheet paper-sheet--wall" id="main-content" tabIndex={-1}>
            {view === "arrive" ? <ArriveCubby onNavigate={navigate} /> : null}
            {view === "run" ? <RunCubby /> : null}
            {view === "demo" ? <DemoCubby /> : null}
            {view === "text" ? <TextCubby /> : null}
            {view === "desk" ? <DeskCubby /> : null}
            {view === "roles" ? <RolesCubby /> : null}
            {view === "rules" ? <RulesCubby /> : null}
            {view === "judge" ? <JudgeCubby /> : null}
          </main>
        </div>
      </div>
    </div>
  );
}
