import { BrandMark } from "../components/BrandMark.js";
import { EventLinks } from "../components/EventLinks.js";
import { parseSlipQuery, type LodgeEvent } from "../lib/calendar.js";

export function SlipPage() {
  const events = parseSlipQuery(new URLSearchParams(window.location.search));

  return (
    <div className="hosted-slip">
      <a className="skip-link" href="#slip-main">
        Skip to slip
      </a>
      <header className="hosted-slip__mast">
        <BrandMark href="/" />
        <p>Paper from the wall</p>
      </header>
      <main id="slip-main" className="paper-sheet" tabIndex={-1}>
        {events.length === 0 ? (
          <EmptySlip />
        ) : (
          <FilledSlip events={events} />
        )}
      </main>
    </div>
  );
}

function EmptySlip() {
  return (
    <>
      <h1>This slip is blank.</h1>
      <p>
        A Lodge card needs event fields on the URL: title, or a week of
        title0 and start0. No phones, names, or conversation keys.
      </p>
      <p>
        <a className="key-link" href="/">
          Back to the wall
        </a>
      </p>
    </>
  );
}

function FilledSlip({ events }: { events: LodgeEvent[] }) {
  return (
    <>
      <h1>{events.length === 1 ? events[0]?.title : "This week"}</h1>
      <p>
        Query-string event fields only. Lodge can edit this card in the thread
        while it works; the tap lands here.
      </p>
      <ol className="slip-events">
        {events.map((event) => (
          <li key={`${event.title}-${event.start ?? event.url ?? ""}`}>
            <h2>{event.title}</h2>
            <p>
              {event.start ? (
                <time dateTime={event.start}>{formatWhen(event.start, event.end)}</time>
              ) : (
                "No clock time on this slip."
              )}
              {event.where ? ` · ${event.where}` : ""}
            </p>
            {event.notes ? <p>{event.notes}</p> : null}
            {event.url ? (
              <p>
                <a className="text-link" href={event.url} rel="noreferrer" target="_blank">
                  Source page
                </a>
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      <EventLinks events={events} />
    </>
  );
}

function formatWhen(start: string, end?: string): string {
  const startDate = Date.parse(start);
  if (Number.isNaN(startDate)) return [start, end].filter(Boolean).join(" – ");
  const startText = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: start.includes("T") ? "2-digit" : undefined,
    minute: start.includes("T") ? "2-digit" : undefined,
  }).format(new Date(startDate));
  if (!end || end === start) return startText;
  const endDate = Date.parse(end);
  if (Number.isNaN(endDate)) return `${startText} – ${end}`;
  return `${startText} – ${new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(endDate))}`;
}
