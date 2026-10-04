import { useState } from "react";
import { Ledger } from "../components/Ledger.js";
import { fixtures, type LodgeFixture } from "../data/fixtures.js";

export function JudgeCubby() {
  const [id, setId] = useState<LodgeFixture["id"]>("due-week");
  const fixture = fixtures.find((item) => item.id === id) ?? fixtures[0]!;

  return (
    <article className="slip-copy">
      <h1>#judge</h1>
      <p>
        Sanitized traces with Search, Fetch, and Agent timings. Replay them
        here. Reviewers without an iPhone can use the terminal harness in the
        repo — this cubby does not open 8787 and does not spend TinyFish.
      </p>
      <div className="choice-row" role="tablist" aria-label="Judge fixtures">
        {fixtures.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === id}
            className={item.id === id ? "choice choice--on" : "choice"}
            onClick={() => setId(item.id)}
          >
            {item.title}
          </button>
        ))}
      </div>
      <p className="asked-line">You asked: {fixture.asked}</p>
      <p>{fixture.summary}</p>
      <Ledger fixture={fixture} />
      {fixture.disagreement ? <p>{fixture.disagreement}</p> : null}
      <p className="quiet-line">
        Checked-live versus own-knowledge is in the ledger. Skipped Agent
        stays skipped. No conversation keys on this page.
      </p>
    </article>
  );
}
