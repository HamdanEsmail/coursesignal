import { useState } from "react";
import { EventLinks } from "../components/EventLinks.js";
import { Ledger } from "../components/Ledger.js";
import { PhoneReplay } from "../components/PhoneReplay.js";
import { FIRSTROLE_URL, fixtures, type LodgeFixture } from "../data/fixtures.js";
import { slipPath } from "../lib/calendar.js";

export function RunCubby() {
  const [id, setId] = useState<LodgeFixture["id"]>("due-week");
  const fixture = fixtures.find((item) => item.id === id) ?? fixtures[0]!;

  return (
    <article className="slip-copy">
      <h1>A run, already on paper.</h1>
      <p>
        Three sanitized fixtures. Lodge used Search, Fetch, and at most one
        read-only Agent. This cubby does not call TinyFish.
      </p>
      <div className="choice-row" role="tablist" aria-label="Fixture runs">
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
      <PhoneReplay fixture={fixture} autoplay={false} />
      <Ledger fixture={fixture} />
      {fixture.events.length > 0 ? (
        <p>
          <a className="key-link" href={slipPath(fixture.events)}>
            Open the slip
          </a>
        </p>
      ) : null}
      <EventLinks events={fixture.events} />
      {fixture.roles ? (
        <ul className="role-list">
          {fixture.roles.map((listing) => (
            <li key={`${listing.company}-${listing.title}`}>
              <strong>
                {listing.company} — {listing.title}
              </strong>
              <span className={listing.openness === "open" ? "badge badge--open" : "badge"}>
                {listing.openness === "open" ? "still open" : "unverified"}
              </span>
              <small>{listing.reason}</small>
            </li>
          ))}
        </ul>
      ) : null}
      {fixture.id === "roles-dubai" ? (
        <p>
          Full shortlist on{" "}
          <a className="text-link" href={FIRSTROLE_URL}>
            FirstRole
          </a>
          . Lodge does not call that API.
        </p>
      ) : null}
      {fixture.disagreement ? <p>{fixture.disagreement}</p> : null}
    </article>
  );
}
