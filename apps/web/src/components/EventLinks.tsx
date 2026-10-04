import { addPath, googleTemplateUrl, icsPath, type LodgeEvent } from "../lib/calendar.js";

type EventLinksProps = {
  events: LodgeEvent[];
};

export function EventLinks({ events }: EventLinksProps) {
  const dated = events.filter((event) => event.start);
  if (dated.length === 0) return null;
  const week = icsPath(dated);
  const fallback = addPath(dated);

  return (
    <div className="event-links">
      <a className="key-link" href={week}>
        Add this week
      </a>
      <a className="text-link" href={fallback}>
        Download if the calendar file is blocked
      </a>
      {dated.map((event) => (
        <a className="text-link" key={`${event.title}-${event.start}`} href={googleTemplateUrl(event)}>
          Google · {event.title}
        </a>
      ))}
    </div>
  );
}
