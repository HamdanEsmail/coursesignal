import { ArrowRight } from "lucide-react";
import { starterCommands } from "../data/commands.js";

type StartViewProps = {
  onOpenExample: () => void;
  onOpenCommands: () => void;
};

export function StartView({ onOpenExample, onOpenCommands }: StartViewProps) {
  return (
    <main className="guide-page" id="main-content" tabIndex={-1}>
      <article className="worksheet">
        <p className="worksheet__kicker">Student field guide</p>
        <h1>Text CourseSignal. Get a sourced answer.</h1>
        <p className="worksheet__lede">
          CourseSignal is a student copilot inside iMessage. The line is{" "}
          <strong>always on</strong> — you can text anytime. Send{" "}
          <kbd>START</kbd> first, then a public syllabus, concept, or campus
          question. It will not submit homework, book anything, or show your
          phone number here.
        </p>

        <ol className="start-steps" aria-label="How to text CourseSignal">
          <li>
            <span>1</span>
            <div>
              <h2>Text START</h2>
              <p>That is consent. Until then, CourseSignal only explains itself.</p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <h2>Ask in ordinary words</h2>
              <p>
                A course concept, public link, deadline, or campus question.
                Keep private LMS pages and IDs out of the thread.
              </p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <h2>Then SOURCES, PLAN, or WATCH</h2>
              <p>
                After an answer, ask for the pages it used, a study plan from
                those pages, or a quiet watch on a public source.
              </p>
            </div>
          </li>
        </ol>

        <div className="command-strip" aria-label="Commands you can send">
          {starterCommands.map((command) => (
            <kbd key={command}>{command}</kbd>
          ))}
          <button type="button" className="text-link" onClick={onOpenCommands}>
            Full crib
            <ArrowRight aria-hidden="true" size={16} />
          </button>
        </div>

        <div className="start-actions">
          <button type="button" className="button" onClick={onOpenExample}>
            See a worked example
            <ArrowRight aria-hidden="true" size={16} />
          </button>
          <p>STAT 210 · conditional probability · public notes</p>
        </div>

        <aside className="reviewer-notes" aria-label="Notes for reviewers">
          <h2>Photon / reviewer notes</h2>
          <p>
            This site is a labeled field guide. It does not send iMessage
            traffic and it does not show a phone number. The iMessage bridge is
            connected — use the managed Messages line to text CourseSignal, not
            this page.
          </p>
        </aside>
      </article>
    </main>
  );
}
