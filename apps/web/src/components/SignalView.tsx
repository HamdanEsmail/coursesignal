import type { Signal } from "@coursesignal/contracts";
import { ChevronRight, Clock3, FileText, Link2, Smartphone } from "lucide-react";

type SignalViewProps = {
  signal: Signal;
  onOpenReceipt: () => void;
};

export function SignalView({ signal, onOpenReceipt }: SignalViewProps) {
  return (
    <main className="signal-view" id="main-content" tabIndex={-1}>
      <div className="signal-view__head">
        <button className="back-link" type="button" onClick={onOpenReceipt}>
          Open full receipt
          <ChevronRight aria-hidden="true" size={16} />
        </button>
        <div className="fixture-label">Synthetic demonstration course</div>
        <h1>{signal.course} — Probability</h1>
        <div className="signal-meta">
          <span><FileText aria-hidden="true" size={16} /> Syllabus</span>
          <span>2 public sources</span>
          <span>Watching deadlines and material changes</span>
        </div>
      </div>

      <div className="conversation">
        <div className="student-message">
          <time>Today, 6:14 PM</time>
          <p>{signal.question}</p>
          <small>Synthetic transcript preview</small>
        </div>

        <article className="assistant-message">
          <div className="assistant-message__identity">
            <span className="mini-signal" aria-hidden="true" />
            <span>CourseSignal</span>
            <time>6:15 PM</time>
          </div>
          <p className="assistant-message__intro">{signal.answer}</p>

          <ol className="action-list">
            {signal.actions.map((action, index) => (
              <li key={action.id}>
                <span className="action-number">{index + 1}</span>
                <div>
                  <h2>{action.title}</h2>
                  <p>{action.detail}</p>
                  <small><FileText aria-hidden="true" size={14} /> {action.sourceLabel}</small>
                </div>
              </li>
            ))}
          </ol>

          <div className="signal-actions">
            <button className="button button--secondary" type="button" onClick={onOpenReceipt}>
              <Link2 aria-hidden="true" size={16} />
              View evidence
              <ChevronRight aria-hidden="true" size={15} />
            </button>
            <span className="checked-time">
              <Clock3 aria-hidden="true" size={15} />
              Fixture checked at 6:16 PM
            </span>
          </div>
        </article>
      </div>

      <div className="thread-handoff" role="note">
        <Smartphone aria-hidden="true" size={20} strokeWidth={1.7} />
        <span>
          <strong>Live questions belong in Messages.</strong>
          <small>This page previews the reply; it never imitates or sends an iMessage.</small>
        </span>
      </div>
    </main>
  );
}
