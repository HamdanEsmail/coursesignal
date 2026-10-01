import { Bell, BellRing, Clock3, Eye, PauseCircle } from "lucide-react";
import type { DemoSettings } from "../state/useDemoSettings.js";
import { FixtureNotice } from "./FixtureNotice.js";
import { PageIntro } from "./PageIntro.js";

type WatchesViewProps = {
  settings: DemoSettings;
  onUpdateSettings: (patch: Partial<DemoSettings>) => void;
};

export function WatchesView({ settings, onUpdateSettings }: WatchesViewProps) {
  return (
    <main className="product-page" id="main-content" tabIndex={-1}>
      <PageIntro
        title="Watches"
        description="Choose which sources may trigger a useful iMessage. CourseSignal stays quiet when nothing meaningful changes."
        aside={
          <span className={`status-token ${settings.watchEnabled ? "status-token--ready" : "status-token--paused"}`}>
            {settings.watchEnabled ? "1 preview watch" : "Paused"}
          </span>
        }
      />
      <FixtureNotice>This watch is local demonstration state. It is not polling a real course site.</FixtureNotice>

      <section className="watch-sheet" aria-labelledby="active-watch-title">
        <div className="watch-sheet__identity">
          <span className="watch-sheet__icon"><Eye aria-hidden="true" size={22} /></span>
          <div>
            <h2 id="active-watch-title">STAT 210 · demonstration sources</h2>
            <p>Deadline changes and newly published materials</p>
          </div>
        </div>
        <label className="switch-control">
          <input
            type="checkbox"
            role="switch"
            checked={settings.watchEnabled}
            onChange={(event) => onUpdateSettings({ watchEnabled: event.target.checked })}
          />
          <span aria-hidden="true" />
          <strong>{settings.watchEnabled ? "On" : "Off"}</strong>
        </label>
        <dl className="watch-facts">
          <div><dt>Trigger</dt><dd>Material source change</dd></div>
          <div><dt>Delivery</dt><dd>{settings.watchEnabled ? "Would send after quiet hours" : "Paused locally"}</dd></div>
          <div><dt>Evidence</dt><dd>Receipt required before notification</dd></div>
        </dl>
      </section>

      <div className="page-grid">
        <section className="section-panel" aria-labelledby="quiet-hours-title">
          <div className="section-panel__heading">
            <div>
              <h2 id="quiet-hours-title">Quiet hours</h2>
              <p>Keep non-urgent course signals out of the night.</p>
            </div>
            <Clock3 aria-hidden="true" size={23} />
          </div>
          <label className="setting-row">
            <span><strong>10:00 PM–8:00 AM</strong><small>Asia/Dubai</small></span>
            <input
              type="checkbox"
              role="switch"
              checked={settings.quietHoursEnabled}
              onChange={(event) => onUpdateSettings({ quietHoursEnabled: event.target.checked })}
            />
          </label>
        </section>

        <section className="section-panel" aria-labelledby="notification-rule-title">
          <div className="section-panel__heading">
            <div>
              <h2 id="notification-rule-title">Notification rule</h2>
              <p>One strong rule, not a noisy settings maze.</p>
            </div>
            {settings.watchEnabled ? <BellRing aria-hidden="true" size={23} /> : <PauseCircle aria-hidden="true" size={23} />}
          </div>
          <p className="large-setting-copy">Message only when a deadline is approaching or a watched source meaningfully changes.</p>
        </section>
      </div>

      <div className="policy-strip">
        <Bell aria-hidden="true" size={19} />
        <p><strong>No “still checking” pings.</strong> Unchanged or non-actionable results stay quiet.</p>
      </div>
    </main>
  );
}
