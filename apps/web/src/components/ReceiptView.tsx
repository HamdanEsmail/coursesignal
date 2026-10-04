import type { ClaimState, Signal } from "@coursesignal/contracts";
import {
  BellOff,
  Check,
  ChevronLeft,
  Clock3,
  ExternalLink,
  FileText,
  MessageCircleQuestion,
  MoreHorizontal,
  Trash2,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import type { DemoSettings } from "../state/useDemoSettings.js";
import { FixtureNotice } from "./FixtureNotice.js";

const stateLabels: Record<ClaimState, string> = {
  verified: "Verified",
  inferred: "Inferred",
  unknown: "Unknown",
  conflicting: "Conflicting",
};

const checkedTime = new Intl.DateTimeFormat("en-AE", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Dubai",
});

type ReceiptViewProps = {
  signal: Signal;
  settings: DemoSettings;
  onBack: () => void;
  onUpdateSettings: (patch: Partial<DemoSettings>) => void;
};

export function ReceiptView({ signal, settings, onBack, onUpdateSettings }: ReceiptViewProps) {
  const [confirmForget, setConfirmForget] = useState(false);

  return (
    <main className="receipt-page" id="main-content" tabIndex={-1}>
      <div className="receipt-toolbar">
        <button type="button" className="receipt-toolbar__back" onClick={onBack}>
          <ChevronLeft aria-hidden="true" size={20} />
          Example
        </button>
        <p className="receipt-toolbar__label">Long form of SOURCES</p>
        <details className="receipt-more">
          <summary aria-label="About this receipt">
            <MoreHorizontal aria-hidden="true" size={21} />
          </summary>
          <p>This is a labeled example of a sourced reply, not a live phone log.</p>
        </details>
      </div>

      <article className="receipt-paper worksheet">
        <FixtureNotice>
          Labeled example of what a sourced reply used. Text SOURCES in iMessage for the live receipt in that chat.
        </FixtureNotice>

        <header className="receipt-hero">
          <p className="worksheet__kicker">What this reply used</p>
          <h1>{signal.course} — {signal.title}</h1>
          <p>{signal.answer}</p>
          <div className="receipt-origin">
            <MessageCircleQuestion aria-hidden="true" size={22} strokeWidth={1.6} />
            <span>
              <small>Student asked</small>
              <strong>{signal.question}</strong>
            </span>
            <time dateTime={signal.checkedAt}>
              <Clock3 aria-hidden="true" size={15} />
              Checked {checkedTime.format(new Date(signal.checkedAt))}
            </time>
          </div>
        </header>

        <ol className="receipt-actions" aria-label="How to use the sourced answer">
          {signal.actions.map((action, index) => (
            <li key={action.id}>
              <span className="receipt-actions__number">{index + 1}</span>
              <div>
                <h2>{action.title}</h2>
                <p>{action.detail}</p>
                <small><FileText aria-hidden="true" size={15} /> {action.sourceLabel}</small>
              </div>
            </li>
          ))}
        </ol>

        <section className="receipt-section" aria-labelledby="receipt-evidence-title">
          <header className="receipt-section__header">
            <h2 id="receipt-evidence-title">Claims in this answer</h2>
            <p>Each claim is marked verified, inferred, unknown, or conflicting — the same honesty SOURCES should show in the thread.</p>
          </header>

          <div className="claim-thread claim-thread--receipt">
            {signal.claims.map((claim) => {
              const sources = signal.sources.filter((source) => claim.sourceIds.includes(source.id));
              return (
                <article className={`claim claim--${claim.state}`} key={claim.id}>
                  <span className="claim__dot" aria-hidden="true" />
                  <div>
                    <span className="claim__state">{stateLabels[claim.state]}</span>
                    <h3>{claim.statement}</h3>
                    {sources.length > 0 ? (
                      <p className="claim__sources">
                        {sources.map((source) => source.title).join(" · ")}
                      </p>
                    ) : (
                      <p>Not enough information was present in the checked sources to be certain.</p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          <details className="receipt-research-path">
            <summary>How CourseSignal checked this</summary>
            <ol>
              {signal.stages.map((stage) => (
                <li key={stage.endpoint}>
                  <strong>{stage.endpoint}</strong>
                  <span>{stage.label}</span>
                  <small>{stage.detail}</small>
                </li>
              ))}
            </ol>
          </details>
        </section>

        <section className="receipt-section receipt-sources" aria-labelledby="receipt-sources-title">
          <header className="receipt-section__header receipt-section__header--small">
            <h2 id="receipt-sources-title">Source receipts</h2>
            <p>Public pages TinyFish Fetch actually read for this fixture.</p>
          </header>

          <div className="source-list">
            {signal.sources.map((source) => {
              const isSynthetic = source.publisher.includes("Synthetic");
              const content = (
                <>
                  <span className="source-row__icon">
                    <FileText aria-hidden="true" size={22} strokeWidth={1.55} />
                    <Check aria-hidden="true" className="source-row__check" size={12} />
                  </span>
                  <span>
                    <strong>{source.title}</strong>
                    <small>
                      {source.publisher} · {source.endpoint === "fetch" ? "read with Fetch" : source.endpoint} · checked {checkedTime.format(new Date(source.checkedAt))}
                    </small>
                  </span>
                  {isSynthetic ? (
                    <small className="source-row__kind">Example only</small>
                  ) : (
                    <ExternalLink aria-hidden="true" size={17} strokeWidth={1.6} />
                  )}
                </>
              );

              return isSynthetic ? (
                <div className="source-row source-row--static" key={source.id}>{content}</div>
              ) : (
                <a className="source-row" href={source.url} key={source.id} target="_blank" rel="noreferrer">
                  {content}
                </a>
              );
            })}
          </div>
        </section>

        {settings.memoryPresent ? (
          <section className="receipt-controls" aria-label="Fixture controls">
            <button
              type="button"
              onClick={() => onUpdateSettings({ watchEnabled: !settings.watchEnabled })}
            >
              <BellOff aria-hidden="true" size={23} />
              <span>
                <strong>{settings.watchEnabled ? "Stop watch" : "Resume watch"}</strong>
                <small>
                  {settings.watchEnabled
                    ? "Pause future preview signals"
                    : "The preview watch is paused"}
                </small>
              </span>
            </button>
            {confirmForget ? (
              <div className="receipt-confirm">
                <p>Remove this synthetic course from local preview memory?</p>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateSettings({ memoryPresent: false, watchEnabled: false });
                    setConfirmForget(false);
                  }}
                >
                  Remove locally
                </button>
                <button type="button" onClick={() => setConfirmForget(false)}>Cancel</button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmForget(true)}>
                <Trash2 aria-hidden="true" size={23} />
                <span>
                  <strong>Forget course</strong>
                  <small>Remove this fixture from this browser</small>
                </span>
              </button>
            )}
          </section>
        ) : (
          <div className="removed-note" role="status">
            <span>This synthetic course was removed from local preview memory.</span>
            <button
              type="button"
              onClick={() => onUpdateSettings({ memoryPresent: true })}
            >
              <Undo2 aria-hidden="true" size={16} /> Restore fixture
            </button>
          </div>
        )}
      </article>
    </main>
  );
}
