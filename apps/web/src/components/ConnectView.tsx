import {
  CalendarClock,
  Check,
  CircleDashed,
  ExternalLink,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  Smartphone,
  UserCheck,
} from "lucide-react";
import { FixtureNotice } from "./FixtureNotice.js";
import { PageIntro } from "./PageIntro.js";

const setupSteps = [
  {
    state: "complete",
    title: "Photon project created",
    detail: "The CourseSignal project exists in the signed-in Photon account.",
  },
  {
    state: "complete",
    title: "Spectrum Pro activated",
    detail: "Access runs through November 1, 2026. Renewal is canceled, so it will not auto-renew.",
  },
  {
    state: "complete",
    title: "Enroll the owner’s iPhone",
    detail: "One owner identity is verified and active in Photon. The number is never displayed in this companion.",
  },
  {
    state: "complete",
    title: "Provision the managed iMessage line",
    detail: "Photon assigned a shared managed line that can exchange messages only with enrolled users.",
  },
  {
    state: "complete",
    title: "Prove the phone round trip",
    detail: "Real iPhone echo, consent, course memory, Search, and Fetch replies returned to the same thread.",
  },
  {
    state: "pending",
    title: "Deploy the always-on bridge",
    detail: "The verified local listener stays offline between controlled tests until a persistent host is approved.",
  },
] as const;

export function ConnectView() {
  return (
    <main className="product-page" id="main-content" tabIndex={-1}>
      <PageIntro
        title="Connect your iPhone"
        description="The private iPhone loop is verified. This screen shows what is live, what is deliberately paused, and what remains before reviewer access."
        aside={<span className="status-token status-token--ready">Transport verified</span>}
      />

      <FixtureNotice>
        Photon enrollment and the managed line are verified. The local listener is kept offline between controlled tests until an always-on host is approved.
      </FixtureNotice>

      <div className="page-grid page-grid--connect">
        <section className="section-panel" aria-labelledby="setup-title">
          <div className="section-panel__heading">
            <div>
              <h2 id="setup-title">Connection checklist</h2>
              <p>Green means verified in the account; outlined steps still need to happen.</p>
            </div>
            <Smartphone aria-hidden="true" size={24} strokeWidth={1.55} />
          </div>

          <ol className="setup-timeline">
            {setupSteps.map((step) => (
              <li className={`setup-step setup-step--${step.state}`} key={step.title}>
                <span className="setup-step__icon" aria-hidden="true">
                  {step.state === "complete" ? <Check size={15} /> : <CircleDashed size={17} />}
                </span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>

          <a className="button button--primary" href="https://photon.codes" target="_blank" rel="noreferrer">
            Open Photon
            <ExternalLink aria-hidden="true" size={16} />
          </a>
        </section>

        <aside className="connect-explainer" aria-labelledby="phone-flow-title">
          <h2 id="phone-flow-title">How the verified phone flow works</h2>
          <ol className="plain-steps">
            <li><span>1</span><p>Open Messages and text the Photon-managed number.</p></li>
            <li><span>2</span><p>Ask a course question or paste a public course link.</p></li>
            <li><span>3</span><p>CourseSignal checks sources with TinyFish and replies in the same thread.</p></li>
            <li><span>4</span><p>Open the receipt link to see what was verified, inferred, or still unknown.</p></li>
          </ol>
          <div className="boundary-note">
            <ShieldCheck aria-hidden="true" size={21} />
            <p><strong>No action by surprise.</strong> CourseSignal explains and watches; it does not submit coursework, buy anything, or contact another person.</p>
          </div>
        </aside>
      </div>

      <section className="reviewer-panel" aria-labelledby="reviewer-title">
        <div className="reviewer-panel__copy">
          <span className="status-token status-token--proposed">Proposed for submission</span>
          <h2 id="reviewer-title">A judge can try the real iMessage loop</h2>
          <p>
            Reviewer access is deliberately off today. The submission build can time-box an allowlisted
            judge, share the managed number privately, and remove access after review.
          </p>
        </div>
        <div className="reviewer-flow" aria-label="Proposed reviewer access flow">
          <div><UserCheck aria-hidden="true" /><strong>Allowlist</strong><span>One reviewed identity</span></div>
          <div><MessageSquareText aria-hidden="true" /><strong>Text</strong><span>A real course request</span></div>
          <div><CalendarClock aria-hidden="true" /><strong>Expire</strong><span>Access ends after review</span></div>
        </div>
        <div className="reviewer-locked" role="status">
          <LockKeyhole aria-hidden="true" size={19} />
          Reviewer invitations remain inactive until the bridge has an approved persistent host and the deletion flow is tested there.
        </div>
      </section>
    </main>
  );
}
