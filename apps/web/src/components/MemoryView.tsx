import { Bell, BellOff, BookOpenText, Clock3, Database, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { DemoSettings } from "../state/useDemoSettings.js";
import { PageIntro } from "./PageIntro.js";

type MemoryViewProps = {
  settings: DemoSettings;
  onUpdateSettings: (patch: Partial<DemoSettings>) => void;
};

export function MemoryView({ settings, onUpdateSettings }: MemoryViewProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <main className="guide-page" id="main-content" tabIndex={-1}>
      <article className="worksheet">
        <PageIntro
          kicker="Per-chat context"
          title="What it remembers"
          description="Each iMessage chat keeps a small, separate context — course names, the last topic, watches, and consent. This page is a local demo of that idea, not your live account."
          aside={
            <span className={`status-token ${settings.memoryPresent ? "status-token--local" : "status-token--paused"}`}>
              {settings.memoryPresent ? "Demo context" : "Cleared here"}
            </span>
          }
        />

        {settings.memoryPresent ? (
          <section className="memory-record" aria-labelledby="memory-course-title">
            <div className="memory-record__head">
              <span>
                <BookOpenText aria-hidden="true" size={22} />
              </span>
              <div>
                <h2 id="memory-course-title">STAT 210</h2>
                <p>Optional course name for this chat</p>
              </div>
            </div>
            <dl className="memory-fields">
              <div>
                <dt>Last topic</dt>
                <dd>Conditional probability</dd>
              </div>
              <div>
                <dt>Last question</dt>
                <dd>Give me an explainable example?</dd>
              </div>
              <div>
                <dt>Not stored</dt>
                <dd>Phone number, passwords, student IDs, private LMS pages</dd>
              </div>
            </dl>
            {confirmDelete ? (
              <div className="inline-confirm" role="alert">
                <p>
                  <strong>Clear this demo?</strong> Local course preference and
                  watch state will be removed from this browser. Live iMessage
                  memory is unchanged — text FORGET there to erase that chat.
                </p>
                <div>
                  <button
                    className="button button--danger"
                    type="button"
                    onClick={() => {
                      onUpdateSettings({ memoryPresent: false, watchEnabled: false });
                      setConfirmDelete(false);
                    }}
                  >
                    Clear demo
                  </button>
                  <button className="button button--secondary" type="button" onClick={() => setConfirmDelete(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button className="text-action text-action--danger" type="button" onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden="true" size={17} />
                Forget this course
              </button>
            )}
          </section>
        ) : (
          <section className="empty-state" aria-labelledby="empty-memory-title">
            <Database aria-hidden="true" size={30} strokeWidth={1.4} />
            <h2 id="empty-memory-title">This browser has no demo memory</h2>
            <p>
              The STAT 210 fixture was cleared here. Text FORGET in iMessage to
              erase a live chat; this page does not reach that memory.
            </p>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => onUpdateSettings({ memoryPresent: true })}
            >
              <RotateCcw aria-hidden="true" size={16} /> Restore demo
            </button>
          </section>
        )}

        <section className="watch-sheet" aria-labelledby="watch-title">
          <div className="watch-sheet__identity">
            <span className="watch-sheet__icon">
              {settings.watchEnabled ? (
                <Bell aria-hidden="true" size={20} />
              ) : (
                <BellOff aria-hidden="true" size={20} />
              )}
            </span>
            <div>
              <h2 id="watch-title">WATCH and STOP</h2>
              <p>
                Text WATCH after a sourced answer to opt into a quiet change
                notice. STOP pauses every watch. CourseSignal does not ping
                when nothing changed.
              </p>
            </div>
          </div>
          <label className="switch-control">
            <input
              type="checkbox"
              role="switch"
              checked={settings.watchEnabled && settings.memoryPresent}
              disabled={!settings.memoryPresent}
              onChange={(event) => onUpdateSettings({ watchEnabled: event.target.checked })}
            />
            <span aria-hidden="true" />
            <strong>{settings.watchEnabled && settings.memoryPresent ? "Demo watch on" : "Demo watch off"}</strong>
          </label>
        </section>

        <section className="section-panel" aria-labelledby="quiet-hours-title">
          <div className="section-panel__heading">
            <div>
              <h2 id="quiet-hours-title">Quiet hours</h2>
              <p>Non-urgent watches stay out of the night in this demo.</p>
            </div>
            <Clock3 aria-hidden="true" size={22} />
          </div>
          <label className="setting-row">
            <span>
              <strong>10:00 PM–8:00 AM</strong>
              <small>Asia/Dubai</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={settings.quietHoursEnabled}
              onChange={(event) => onUpdateSettings({ quietHoursEnabled: event.target.checked })}
            />
          </label>
        </section>
      </article>
    </main>
  );
}
