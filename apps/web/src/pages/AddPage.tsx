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
        <p>This week</p>
      </header>
      <main id="add-main" className="paper-sheet" tabIndex={-1}>
        {events.length === 0 ? (
          <>
            <h1>Nothing to add yet.</h1>
            <p>
              When Lodge texts a week, this page saves it to your calendar. Open it from a slip in
              the thread.
            </p>
            <p>
              <a className="key-link" href="/">
                Back to Lodge
              </a>
            </p>
          </>
        ) : (
          <>
            <h1>{events.length === 1 ? events[0]?.title : `${events.length} things this week`}</h1>
            <p>
              {status === "downloaded"
                ? "Your calendar file is ready. If nothing downloaded, use the button."
                : "One week from Lodge. Add it to your calendar."}
            </p>
            <ul className="slip-events">
              {events.map((event) => (
                <li key={`${event.title}-${event.start ?? ""}`}>
                  <h2>{event.title}</h2>
                  <p>
                    {event.start ? formatWhen(event.start, event.end) : ""}
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
              Download this week
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
