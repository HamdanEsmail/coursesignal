import { BookOpenText, Database, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { DemoSettings } from "../state/useDemoSettings.js";
import { FixtureNotice } from "./FixtureNotice.js";
import { PageIntro } from "./PageIntro.js";

type MemoryViewProps = {
  settings: DemoSettings;
  onUpdateSettings: (patch: Partial<DemoSettings>) => void;
};

export function MemoryView({ settings, onUpdateSettings }: MemoryViewProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <main className="product-page" id="main-content" tabIndex={-1}>
      <PageIntro
        title="Memory"
        description="See the minimum context CourseSignal would keep so follow-up messages remain useful—and remove it without digging through settings."
        aside={<span className="status-token status-token--local">Stored in this browser</span>}
      />
      <FixtureNotice>Only synthetic preview preferences are stored locally. No iMessage history has been imported.</FixtureNotice>

      {settings.memoryPresent ? (
        <section className="memory-record" aria-labelledby="memory-course-title">
          <div className="memory-record__head">
            <span><BookOpenText aria-hidden="true" size={23} /></span>
            <div>
              <h2 id="memory-course-title">STAT 210</h2>
              <p>Synthetic demonstration course</p>
            </div>
            <span className="status-token status-token--local">Fixture</span>
          </div>
          <dl className="memory-fields">
            <div><dt>Current unit</dt><dd>Random variables and expectation</dd></div>
            <div><dt>Preferred answer</dt><dd>Concise plan with source links</dd></div>
            <div><dt>Watched change</dt><dd>Deadlines and new course materials</dd></div>
            <div><dt>Not remembered</dt><dd>Passwords, private messages, or coursework submissions</dd></div>
          </dl>

          {confirmDelete ? (
            <div className="inline-confirm" role="alert">
              <p><strong>Remove this fixture?</strong> Its local course preference and watch state will be cleared.</p>
              <div>
                <button
                  className="button button--danger"
                  type="button"
                  onClick={() => {
                    onUpdateSettings({ memoryPresent: false, watchEnabled: false });
                    setConfirmDelete(false);
                  }}
                >
                  Remove fixture
                </button>
                <button className="button button--secondary" type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="text-action text-action--danger" type="button" onClick={() => setConfirmDelete(true)}>
              <Trash2 aria-hidden="true" size={17} /> Forget this course
            </button>
          )}
        </section>
      ) : (
        <section className="empty-state" aria-labelledby="empty-memory-title">
          <Database aria-hidden="true" size={31} strokeWidth={1.4} />
          <h2 id="empty-memory-title">This browser has no course memory</h2>
          <p>The synthetic STAT 210 fixture was removed. Live phone memory is not connected.</p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => onUpdateSettings({ memoryPresent: true })}
          >
            <RotateCcw aria-hidden="true" size={16} /> Restore fixture
          </button>
        </section>
      )}
    </main>
  );
}
