import { DatabaseZap, KeyRound, MessageSquareLock, RotateCcw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { DemoSettings } from "../state/useDemoSettings.js";
import { FixtureNotice } from "./FixtureNotice.js";
import { PageIntro } from "./PageIntro.js";

type PrivacyViewProps = {
  settings: DemoSettings;
  onUpdateSettings: (patch: Partial<DemoSettings>) => void;
  onReset: () => void;
};

export function PrivacyView({ settings, onUpdateSettings, onReset }: PrivacyViewProps) {
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <main className="product-page" id="main-content" tabIndex={-1}>
      <PageIntro
        title="Privacy"
        description="The honest boundary between Apple Messages, Photon, CourseSignal, TinyFish, and the optional OpenRouter composer—plus controls that stay understandable."
        aside={<span className="status-token status-token--ready">Transport verified</span>}
      />
      <FixtureNotice>No phone identity, iMessage content, or private course material appears in this preview.</FixtureNotice>

      <section className="privacy-principles" aria-label="Privacy principles">
        <article>
          <MessageSquareLock aria-hidden="true" />
          <h2>No encryption theatre</h2>
          <p>Messages leave Apple’s end-to-end boundary when Photon and CourseSignal process them. The product says so plainly.</p>
        </article>
        <article>
          <KeyRound aria-hidden="true" />
          <h2>Minimum provider context</h2>
          <p>TinyFish receives the smallest public-web research request needed. If answer composition is enabled, OpenRouter receives only the current sanitized question and short TinyFish evidence—not a phone number, prior chat, or saved course name.</p>
        </article>
        <article>
          <ShieldCheck aria-hidden="true" />
          <h2>User-controlled memory</h2>
          <p>Course context is isolated per person, visible in Memory, and removable without contacting support.</p>
        </article>
      </section>

      <div className="page-grid">
        <section className="section-panel" aria-labelledby="retention-title">
          <div className="section-panel__heading">
            <div>
              <h2 id="retention-title">Preview retention choice</h2>
              <p>This local choice demonstrates the intended product control.</p>
            </div>
            <DatabaseZap aria-hidden="true" size={23} />
          </div>
          <fieldset className="retention-options">
            <legend>Keep future source receipts for</legend>
            {[7, 30].map((days) => (
              <label key={days}>
                <input
                  type="radio"
                  name="retention"
                  value={days}
                  checked={settings.retentionDays === days}
                  onChange={() => onUpdateSettings({ retentionDays: days as 7 | 30 })}
                />
                <span><strong>{days} days</strong><small>{days === 7 ? "Recommended for the pilot" : "Useful for a longer review"}</small></span>
              </label>
            ))}
          </fieldset>
        </section>

        <section className="section-panel" aria-labelledby="data-status-title">
          <div className="section-panel__heading">
            <div>
              <h2 id="data-status-title">Current data status</h2>
              <p>What exists in this build right now.</p>
            </div>
            <ShieldCheck aria-hidden="true" size={23} />
          </div>
          <dl className="data-ledger">
            <div><dt>iPhone enrollment</dt><dd>Verified in Photon; hidden here</dd></div>
            <div><dt>Live iMessage content</dt><dd>Not retained from the transport proof</dd></div>
            <div><dt>Fixture preferences</dt><dd>Local browser only</dd></div>
            <div><dt>OpenRouter composer</dt><dd>Optional, server-only, bounded evidence</dd></div>
            <div><dt>Reviewer access</dt><dd>Not active</dd></div>
          </dl>
        </section>
      </div>

      <section className="reset-panel" aria-labelledby="reset-title">
        <div>
          <h2 id="reset-title">Reset this local preview</h2>
          <p>Clear the watch, retention, and course-memory choices stored by this browser.</p>
        </div>
        {confirmReset ? (
          <div className="inline-confirm inline-confirm--horizontal" role="alert">
            <p>Reset all local preview choices?</p>
            <div>
              <button
                className="button button--danger"
                type="button"
                onClick={() => {
                  onReset();
                  setConfirmReset(false);
                }}
              >Reset preview</button>
              <button className="button button--secondary" type="button" onClick={() => setConfirmReset(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="button button--secondary" type="button" onClick={() => setConfirmReset(true)}>
            <RotateCcw aria-hidden="true" size={16} /> Reset local preview
          </button>
        )}
      </section>
    </main>
  );
}
