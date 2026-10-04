import { useEffect, useMemo, useState } from "react";
import { BrandMark } from "../components/BrandMark.js";
import { buildIcs, parseEventQuery } from "../lib/calendar.js";
import { isIcsPath } from "../lib/route.js";

export function AddPage() {
  const events = useMemo(
    () => parseEventQuery(new URLSearchParams(window.location.search)),
    [],
  );
  const [status, setStatus] = useState(events.length === 0 ? "empty" : "ready");

  useEffect(() => {
    if (events.length === 0) return;
    if (isIcsPath() && typeof document !== "undefined") {
      downloadIcs(events);
      setStatus("downloaded");
    }
  }, [events]);

  return (
    <div className="hosted-slip">
      <a className="skip-link" href="#add-main">
        Skip to calendar file
      </a>
      <header className="hosted-slip__mast">
        <BrandMark href="/" />
        <p>Week file</p>
      </header>
      <main id="add-main" className="paper-sheet" tabIndex={-1}>
        {events.length === 0 ? (
          <>
            <h1>Nothing to add yet.</h1>
            <p>
              /add.ics needs title and start, or indexed week fields such as
              title0 and start0. Identity keys on the query string are
              ignored.
            </p>
            <p>
              If this host cannot serve text/calendar, this /add page is the
              download fallback.
            </p>
          </>
        ) : (
          <>
            <h1>{events.length === 1 ? events[0]?.title : `${events.length} events this week`}</h1>
            <p>
              {status === "downloaded"
                ? "The calendar file was offered as a download. If your browser blocked it, use the button."
                : "One Lodge week file. The live /add.ics route sends text/calendar when the host supports it."}
            </p>
            <ul className="slip-events">
              {events.map((event) => (
                <li key={`${event.title}-${event.start ?? ""}`}>
                  <h2>{event.title}</h2>
                  <p>
                    {event.start}
                    {event.where ? ` · ${event.where}` : ""}
                  </p>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="key-link key-link--button"
              onClick={() => {
                downloadIcs(events);
                setStatus("downloaded");
              }}
            >
              Download lodge.ics
            </button>
          </>
        )}
      </main>
    </div>
  );
}

function downloadIcs(events: ReturnType<typeof parseEventQuery>) {
  const blob = new Blob([buildIcs(events)], { type: "text/calendar;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = "lodge.ics";
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}
