import type { ClaimState, Signal } from "@coursesignal/contracts";
import {
  Bot,
  BellOff,
  Check,
  CircleHelp,
  ExternalLink,
  FileText,
  Search,
  Sprout,
  Trash2,
  Undo2,
} from "lucide-react";
import { useState } from "react";

const stageIcons = {
  search: Search,
  fetch: FileText,
  agent: Bot,
} as const;

const stateLabels: Record<ClaimState, string> = {
  verified: "Verified",
  inferred: "Inferred",
  unknown: "Unknown",
  conflicting: "Conflicting",
};

type EvidenceRailProps = {
  signal: Signal;
  compact?: boolean;
};

export function EvidenceRail({ signal, compact = false }: EvidenceRailProps) {
  const [watchStopped, setWatchStopped] = useState(false);
  const [fixtureForgotten, setFixtureForgotten] = useState(false);

  if (compact) {
    return (
      <section className="mobile-evidence" id="evidence" aria-labelledby="mobile-evidence-title">
        <header className="section-heading">
          <h2 id="mobile-evidence-title">Evidence for this answer</h2>
          <p>Each important claim shows how it was supported.</p>
        </header>
        <div className="claim-thread">
          {signal.claims.map((claim) => (
            <article className={`claim claim--${claim.state}`} key={claim.id}>
              <span className="claim__dot" aria-hidden="true" />
              <div>
                <span className="claim__state">{stateLabels[claim.state]}</span>
                <h3>{claim.statement}</h3>
                {claim.sourceIds.length === 0 ? (
                  <p>No supporting statement was available in the checked sources.</p>
                ) : null}
              </div>
            </article>
          ))}
        </div>

        <details className="mobile-research-path">
          <summary>Research path</summary>
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

        <section className="mobile-source-section" aria-labelledby="mobile-sources-title">
          <header className="section-heading section-heading--small">
            <h2 id="mobile-sources-title">Source receipts</h2>
            <p>The public sources used to support this demonstration answer.</p>
          </header>
          <div className="source-list">
            {signal.sources.map((source) => {
              const isSynthetic = source.publisher.includes("Synthetic");
              const row = (
                <>
                  <span className="source-row__icon">
                    <FileText aria-hidden="true" size={22} strokeWidth={1.55} />
                    <Check aria-hidden="true" className="source-row__check" size={12} />
                  </span>
                  <span>
                    <strong>{source.title}</strong>
                    <small>{source.publisher} · checked 6:16 PM</small>
                  </span>
                  {isSynthetic ? <small className="source-row__kind">Example</small> : <ExternalLink aria-hidden="true" size={17} strokeWidth={1.6} />}
                </>
              );
              return isSynthetic ? (
                <div className="source-row source-row--static" key={source.id}>{row}</div>
              ) : (
                <a className="source-row" href={source.url} key={source.id} target="_blank" rel="noreferrer">{row}</a>
              );
            })}
          </div>
        </section>

        {fixtureForgotten ? (
          <div className="fixture-action-note" role="status">
            <span>This fixture course was removed locally.</span>
            <button type="button" onClick={() => setFixtureForgotten(false)}>
              <Undo2 aria-hidden="true" size={15} /> Undo
            </button>
          </div>
        ) : (
          <div className="mobile-receipt-actions">
            <button type="button" onClick={() => setWatchStopped((stopped) => !stopped)}>
              <BellOff aria-hidden="true" size={20} />
              <span>
                <strong>{watchStopped ? "Resume watch" : "Stop watch"}</strong>
                <small>{watchStopped ? "Notifications remain paused" : "No new source-change messages"}</small>
              </span>
            </button>
            <button type="button" onClick={() => setFixtureForgotten(true)}>
              <Trash2 aria-hidden="true" size={20} />
              <span>
                <strong>Forget course</strong>
                <small>Remove this local fixture memory</small>
              </span>
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <aside className="evidence-rail" id="evidence" aria-labelledby="evidence-title">
      <header className="section-heading">
        <h2 id="evidence-title">Evidence</h2>
        <p>How CourseSignal found and checked this answer.</p>
      </header>

      <ol className="research-path">
        {signal.stages.map((stage) => {
          const Icon = stageIcons[stage.endpoint];
          return (
            <li className={`research-stage research-stage--${stage.status}`} key={stage.endpoint}>
              <span className="research-stage__node" aria-hidden="true" />
              <Icon aria-hidden="true" size={21} strokeWidth={1.65} />
              <div>
                <h3>
                  <span>{stage.endpoint}</span> — {stage.label}
                </h3>
                <p>{stage.detail}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <section className="source-section" aria-labelledby="sources-title">
        <header className="section-heading section-heading--small">
          <h2 id="sources-title">Source receipts</h2>
          <p>The public sources used to support this demonstration answer.</p>
        </header>
        <div className="source-list">
          {signal.sources.map((source) => {
            const isSynthetic = source.publisher.includes("Synthetic");
            const row = (
              <>
                <span className="source-row__icon">
                  <FileText aria-hidden="true" size={22} strokeWidth={1.55} />
                  <Check aria-hidden="true" className="source-row__check" size={12} />
                </span>
                <span>
                  <strong>{source.title}</strong>
                  <small>{source.publisher}</small>
                </span>
                {isSynthetic ? <small className="source-row__kind">Example</small> : <ExternalLink aria-hidden="true" size={17} strokeWidth={1.6} />}
              </>
            );
            return isSynthetic ? (
              <div className="source-row source-row--static" key={source.id}>{row}</div>
            ) : (
              <a className="source-row" href={source.url} key={source.id} target="_blank" rel="noreferrer">{row}</a>
            );
          })}
        </div>
      </section>

      <div className="quiet-note">
        <Sprout aria-hidden="true" size={24} strokeWidth={1.5} />
        <div>
          <strong>Quiet until something changes.</strong>
          <p>CourseSignal only sends an opted-in update when a watched source materially changes.</p>
        </div>
      </div>

      <details className="rail-disclosure">
        <summary>
          <CircleHelp aria-hidden="true" size={17} />
          About this preview
        </summary>
        <p>
          This screen uses a clearly labeled synthetic course fixture. Live evidence will replace it
          after the phone proof is complete.
        </p>
      </details>
    </aside>
  );
}
