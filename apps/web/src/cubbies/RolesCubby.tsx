import { FIRSTROLE_URL, rolesFixture } from "../data/fixtures.js";

export function RolesCubby() {
  return (
    <article className="slip-copy">
      <h1>Roles</h1>
      <p>
        Lodge is the text desk. Ask “any internships in Dubai?” and it returns
        1–3 public openings: company, title, still-open where Agent ran, a
        source, and a match reason. Heart one to pin it. “I applied” marks
        applied. That is the whole tracker.
      </p>
      <p>
        FirstRole is the workspace — full shortlist, compare-3, six statuses.
        Same family, two doors. This site only links there. It does not call
        FirstRole’s API, and it does not spend that ledger.
      </p>
      <ul className="role-list">
        {rolesFixture.roles?.map((listing) => (
          <li key={`${listing.company}-${listing.title}`}>
            <strong>
              {listing.company} — {listing.title}
            </strong>
            <span className={listing.openness === "open" ? "badge badge--open" : "badge"}>
              {listing.openness === "open" ? "still open" : "unverified"}
            </span>
            <small>{listing.reason} · fixture listing</small>
          </li>
        ))}
      </ul>
      <p>
        <a className="key-link" href={FIRSTROLE_URL}>
          Full shortlist on FirstRole
        </a>
      </p>
      <p className="quiet-line">
        Lodge never types, signs in, or submits. Unverified stays unlabeled as
        verified. Opt-in watch: at most one roles search per day, and only if a
        new verified-open URL appears.
      </p>
    </article>
  );
}
