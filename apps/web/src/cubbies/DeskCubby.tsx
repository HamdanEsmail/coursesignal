import { useState } from "react";
import { useDeskSettings } from "../state/useDeskSettings.js";

export function DeskCubby() {
  const { settings, updateSettings, resetSettings } = useDeskSettings();
  const [confirm, setConfirm] = useState(false);

  return (
    <article className="slip-copy">
      <h1>The desk</h1>
      <p>
        After START, Lodge may ask three optional things: school (timezone), a
        course page, an events page, and roles plus a city if you want them.
        skip always works. This cubby is a local sketch of that desk, not your
        live chat.
      </p>

      <section>
        <h2>Notebook</h2>
        {settings.notebookPresent ? (
          <>
            <p>
              Heart the last list, or say “note that office hours moved.” About
              thirty lines. FORGET clears it. This fixture holds a problem-set
              date and one Dubai opening marked applied.
            </p>
            <button
              type="button"
              className="text-link"
              onClick={() => {
                updateSettings({ notebookPresent: false, pageWatchEnabled: false });
              }}
            >
              Clear the fixture notebook
            </button>
          </>
        ) : (
          <p>
            Notebook empty in this browser.{" "}
            <button type="button" className="text-link" onClick={() => updateSettings({ notebookPresent: true })}>
              Restore the fixture
            </button>
          </p>
        )}
      </section>

      <section>
        <h2>Wake-up calls</h2>
        <p>
          “Remind me in 5 minutes” becomes a clock time in your timezone. Lodge
          texts first. 👍 done. You-asked reminders ignore the corridor quiet
          hours of 22:00–08:00.
        </p>
        <label className="switch-row">
          <span>Fixture reminder armed</span>
          <input
            type="checkbox"
            role="switch"
            checked={settings.reminderArmed}
            onChange={(event) => updateSettings({ reminderArmed: event.target.checked })}
          />
        </label>
      </section>

      <section>
        <h2>Page-change alert</h2>
        <p>
          After a link is saved, Lodge Fetches it on a timer, hashes the
          readable text, and texts only when it actually changed. Silence if
          unchanged. Opt-in. At most one roles search per day.
        </p>
        <label className="switch-row">
          <span>Fixture page alert on</span>
          <input
            type="checkbox"
            role="switch"
            checked={settings.pageWatchEnabled && settings.notebookPresent}
            disabled={!settings.notebookPresent}
            onChange={(event) => updateSettings({ pageWatchEnabled: event.target.checked })}
          />
        </label>
      </section>

      <section>
        <h2>Quiet hours</h2>
        <p>Non-urgent desk notes stay out of the corridor night.</p>
        <label className="switch-row">
          <span>22:00–08:00</span>
          <input
            type="checkbox"
            role="switch"
            checked={settings.quietHoursEnabled}
            onChange={(event) => updateSettings({ quietHoursEnabled: event.target.checked })}
          />
        </label>
      </section>

      {confirm ? (
        <p>
          Reset this browser’s desk sketch?{" "}
          <button
            type="button"
            className="text-link"
            onClick={() => {
              resetSettings();
              setConfirm(false);
            }}
          >
            Reset
          </button>{" "}
          <button type="button" className="text-link" onClick={() => setConfirm(false)}>
            Keep it
          </button>
        </p>
      ) : (
        <button type="button" className="text-link" onClick={() => setConfirm(true)}>
          Reset local desk
        </button>
      )}
    </article>
  );
}
