import { ArrowRight } from "lucide-react";
import { demoThread } from "../data/sampleSignal.js";
import { FixtureNotice } from "./FixtureNotice.js";

const walkLabels = [
  "You asked a public course question.",
  "CourseSignal acknowledges immediately.",
  "Then the sourced answer — not a guess.",
  "A short follow-up stays on the same topic.",
  "It checks sources again before answering.",
  "The numeric example came from public notes.",
];

type ExampleViewProps = {
  onOpenSources: () => void;
};

export function ExampleView({ onOpenSources }: ExampleViewProps) {
  return (
    <main className="guide-page" id="main-content" tabIndex={-1}>
      <article className="worksheet">
        <p className="worksheet__kicker">Worked problem</p>
        <h1>A STAT 210 thread, taught</h1>
        <p className="worksheet__lede">
          This is today’s fixture: a student asks what conditional probability
          is, then asks for an example. Read it as a recitation problem — the
          Messages thread is the prompt, the receipt is the worked solution.
        </p>
        <FixtureNotice>
          Labeled example rebuilt from public notes. It is not a live phone log.
        </FixtureNotice>

        <ol className="walkthrough" aria-label="STAT 210 iMessage walkthrough">
          {demoThread.map((bubble, index) => (
            <li
              className={`walk-step walk-step--${bubble.role}`}
              key={`${bubble.role}-${index}`}
              style={{ animationDelay: `${index * 90}ms` }}
            >
              <p className="walk-step__label">
                <span>{index + 1}</span>
                {walkLabels[index]}
              </p>
              <div className={`imessage-bubble imessage-bubble--${bubble.role}`}>
                <p>
                  {bubble.text.includes("P(R)=0.23") ? (
                    <>
                      If 23% of days in a city are rainy, <mark>P(R)=0.23</mark>.
                      After you learn the day is cloudy, you want P(R|C)—rain
                      inside that smaller set of cloudy days.
                    </>
                  ) : (
                    bubble.text
                  )}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <div className="start-actions">
          <button type="button" className="button" onClick={onOpenSources}>
            See the sources for this answer
            <ArrowRight aria-hidden="true" size={16} />
          </button>
          <p>That is the long form of texting SOURCES.</p>
        </div>
      </article>
    </main>
  );
}
