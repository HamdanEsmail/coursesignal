import { RotateCcw } from "lucide-react";
import { useState } from "react";
import type { DemoSettings } from "../state/useDemoSettings.js";
import { PageIntro } from "./PageIntro.js";

type PrivacyViewProps = {
  settings: DemoSettings;
  onUpdateSettings: (patch: Partial<DemoSettings>) => void;
  onReset: () => void;
};

export function PrivacyView({ settings, onUpdateSettings, onReset }: PrivacyViewProps) {
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <main className="guide-page" id="main-content" tabIndex={-1}>
      <article className="worksheet">
        <PageIntro
          kicker="In plain words"
          title="What happens to a text"
          description="Plain words for the path a message takes after you send it. CourseSignal is useful because it can read public pages — that also means the text leaves Apple’s end-to-end Messages boundary."
        />

        <ol className="privacy-steps">
          <li>
            <h2>You send it in Messages</h2>
            <p>
              You text the managed CourseSignal line like any other iMessage.
              This website never sees that thread and never shows your number.
            </p>
          </li>
          <li>
            <h2>It leaves Apple’s lock</h2>
            <p>
              Photon and CourseSignal have to read the text to research it.
              Messages between two iPhones stay end-to-end encrypted; a
              copilot in the thread cannot.
            </p>
          </li>
          <li>
            <h2>TinyFish sees a research request</h2>
            <p>
              TinyFish Search and Fetch look at public web pages for the
              question. They do not get your phone number or a saved course
              name as identity.
            </p>
          </li>
          <li>
            <h2>Gemma may see this question</h2>
            <p>
              If the optional answer composer is on, OpenRouter’s Gemma model
              receives the current sanitized question and short TinyFish
              evidence. A short follow-up may include the last topic — not
              your earlier messages, and not your number.
            </p>
          </li>
          <li>
            <h2>Erase with FORGET</h2>
            <p>
              Text FORGET, then FORGET CONFIRM within ten minutes. That
              deletes this chat’s course names, latest receipt, watches, and
              consent. Reply START if you want to use it again.
            </p>
          </li>
        </ol>

        <section className="section-panel" aria-labelledby="retention-title">
          <div className="section-panel__heading">
            <div>
              <h2 id="retention-title">How long this demo keeps a receipt</h2>
              <p>A local choice only. Live chats follow FORGET, not this switch.</p>
            </div>
          </div>
          <fieldset className="retention-options">
            <legend className="sr-only">Keep future source receipts for</legend>
            {[7, 30].map((days) => (
              <label key={days}>
                <input
                  type="radio"
                  name="retention"
                  value={days}
                  checked={settings.retentionDays === days}
                  onChange={() => onUpdateSettings({ retentionDays: days as 7 | 30 })}
                />
                <span>
                  <strong>{days} days</strong>
                  <small>{days === 7 ? "Shorter demo window" : "Longer demo window"}</small>
                </span>
              </label>
            ))}
          </fieldset>
        </section>

        <section className="reset-panel" aria-labelledby="reset-title">
          <div>
            <h2 id="reset-title">Reset this browser’s demo</h2>
            <p>Clears local watch, retention, and course-memory toggles on this site.</p>
          </div>
          {confirmReset ? (
            <div className="inline-confirm inline-confirm--horizontal" role="alert">
              <p>Reset all local demo choices?</p>
              <div>
                <button
                  className="button button--danger"
                  type="button"
                  onClick={() => {
                    onReset();
                    setConfirmReset(false);
                  }}
                >
                  Reset demo
                </button>
                <button className="button button--secondary" type="button" onClick={() => setConfirmReset(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className="button button--secondary" type="button" onClick={() => setConfirmReset(true)}>
              <RotateCcw aria-hidden="true" size={16} /> Reset local demo
            </button>
          )}
        </section>
      </article>
    </main>
  );
}
