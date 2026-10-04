import { createHash } from "node:crypto";

/**
 * Lodge calendar helpers. Public pages stay on the existing Pages host
 * `https://coursesignal-bzb.pages.dev` (project not renamed). Product copy is Lodge:
 * slip, week file, Add to calendar.
 *
 * Query encoding (event fields only — never conversation keys, phones, or names):
 *
 *   title, start, end, location, url
 *
 * `start` / `end` are UTC ISO-8601 (`…Z`). `url` is the public source page.
 *
 * One Lodge event (`/add.ics` or `/slip`):
 *   ?title=Flu%20clinic&start=2026-10-08T08:00:00.000Z&end=2026-10-08T09:00:00.000Z
 *    &location=Health%20Center&url=https%3A%2F%2Fhealth.example.edu%2Fflu
 *
 * Lodge week file (several VEVENTs on one `/add.ics`): the same keys with a 0-based suffix.
 *   ?title0=…&start0=…&end0=…&location0=…&url0=…&title1=…&start1=…&end1=…
 *
 * Parse with `parseLodgeEventQuery`. Unknown keys are ignored.
 */
export const LODGE_PAGES_ORIGIN = "https://coursesignal-bzb.pages.dev";
export const LODGE_ICS_PATH = "/add.ics";
export const GOOGLE_CALENDAR_TEMPLATE = "https://calendar.google.com/calendar/render";
export const LODGE_EVENT_QUERY_KEYS = ["title", "start", "end", "location", "url"] as const;
export const MAX_WEEK_EVENTS = 20;
export const ADD_TO_CALENDAR_LABEL = "Add to calendar";
export const LODGE_WEEK_FILE_LABEL = "Lodge week file";

const EVENT_KEY_PATTERN = /^(title|start|end|location|url)\d*$/;

export type CalendarEvent = {
  title: string;
  start: string;
  end: string;
  location?: string;
  url?: string;
};

export type NamedLink = {
  label: string;
  url: string;
};

export type LodgeQueryFields = {
  title: string;
  start?: string;
  end?: string;
  location?: string;
  url?: string;
};

export type NamedLinkOptions = {
  timeZone?: string;
};

export function formatEventLabel(
  input: { title: string; start?: string },
  timeZone = "UTC",
): string {
  const title = requireTitle(input.title);
  if (!input.start) return title;
  const start = requireDate(input.start, "start");
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(start);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  return `${title} · ${weekday} ${hour}:${minute}`;
}

export function encodeLodgeQuery(fields: LodgeQueryFields, suffix = ""): URLSearchParams {
  const params = new URLSearchParams();
  params.set(`title${suffix}`, requireTitle(fields.title));
  const start = fields.start?.trim() ? toUtcIso(fields.start, "start") : undefined;
  const end = fields.end?.trim() ? toUtcIso(fields.end, "end") : undefined;
  if (start && end && Date.parse(end) <= Date.parse(start)) {
    throw new Error("Lodge event end must be after start");
  }
  if (start) params.set(`start${suffix}`, start);
  if (end) params.set(`end${suffix}`, end);
  const location = fields.location?.trim();
  if (location) params.set(`location${suffix}`, location);
  const source = fields.url?.trim();
  if (source) params.set(`url${suffix}`, requirePublicHttpUrl(source));
  return params;
}

export function parseLodgeQuery(query: string | URLSearchParams): LodgeQueryFields[] {
  const params = asSearchParams(query);
  if (params.has("title0")) {
    const events: LodgeQueryFields[] = [];
    for (let index = 0; params.has(`title${index}`); index += 1) {
      events.push(readLodgeFields(params, String(index)));
    }
    return events;
  }
  if (params.has("title")) return [readLodgeFields(params, "")];
  return [];
}

export function parseLodgeEventQuery(query: string | URLSearchParams): CalendarEvent[] {
  return parseLodgeQuery(query).map((fields, index) => {
    if (!fields.start || !fields.end) {
      throw new Error(`Lodge event ${index} is missing start or end`);
    }
    return pickCalendarEvent(fields);
  });
}

export function lodgePageUrl(path: string, params: URLSearchParams): string {
  const url = new URL(path, LODGE_PAGES_ORIGIN);
  url.search = params.toString();
  return url.toString();
}

export function buildGoogleCalendarTemplateUrl(input: CalendarEvent): string {
  const event = pickCalendarEvent(input);
  const params = new URLSearchParams();
  params.set("action", "TEMPLATE");
  params.set("text", event.title);
  params.set("dates", `${compactUtc(event.start)}/${compactUtc(event.end)}`);
  if (event.location) params.set("location", event.location);
  if (event.url) params.set("details", event.url);
  return `${GOOGLE_CALENDAR_TEMPLATE}?${params.toString()}`;
}

export function buildLodgeIcsUrl(input: CalendarEvent): string {
  return lodgePageUrl(LODGE_ICS_PATH, encodeLodgeQuery(pickCalendarEvent(input)));
}

export function buildLodgeWeekIcsUrl(inputs: readonly CalendarEvent[]): string {
  const events = requireWeekEvents(inputs);
  const params = new URLSearchParams();
  events.forEach((event, index) => {
    for (const [key, value] of encodeLodgeQuery(event, String(index))) {
      params.append(key, value);
    }
  });
  return lodgePageUrl(LODGE_ICS_PATH, params);
}

export function buildIcsBody(
  input: CalendarEvent | readonly CalendarEvent[],
  options: { now?: Date } = {},
): string {
  const events = Array.isArray(input) ? requireWeekEvents(input) : [pickCalendarEvent(input)];
  const stamp = compactUtc((options.now ?? new Date()).toISOString());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lodge//Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  if (events.length > 1) lines.push("X-WR-CALNAME:Lodge week file");
  for (const event of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${eventUid(event)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${compactUtc(event.start)}`,
      `DTEND:${compactUtc(event.end)}`,
      `SUMMARY:${escapeIcsText(event.title)}`,
    );
    if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
    if (event.url) {
      lines.push(`URL:${event.url}`);
      lines.push(`DESCRIPTION:${escapeIcsText(event.url)}`);
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

export function namedGoogleCalendarLink(
  input: CalendarEvent,
  options: NamedLinkOptions = {},
): NamedLink {
  return {
    label: `${ADD_TO_CALENDAR_LABEL} · ${formatEventLabel(input, options.timeZone)}`,
    url: buildGoogleCalendarTemplateUrl(input),
  };
}

export function namedLodgeIcsLink(
  input: CalendarEvent,
  options: NamedLinkOptions = {},
): NamedLink {
  return {
    label: `${ADD_TO_CALENDAR_LABEL} · ${formatEventLabel(input, options.timeZone)}`,
    url: buildLodgeIcsUrl(input),
  };
}

export function namedLodgeWeekIcsLink(
  inputs: readonly CalendarEvent[],
): NamedLink {
  const events = requireWeekEvents(inputs);
  const count = events.length;
  return {
    label: `${LODGE_WEEK_FILE_LABEL} · ${count} ${count === 1 ? "event" : "events"}`,
    url: buildLodgeWeekIcsUrl(events),
  };
}

export function pickCalendarEvent(input: CalendarEvent): CalendarEvent {
  const title = requireTitle(input.title);
  const start = toUtcIso(input.start, "start");
  const end = toUtcIso(input.end, "end");
  if (Date.parse(end) <= Date.parse(start)) {
    throw new Error("Lodge event end must be after start");
  }
  const event: CalendarEvent = { title, start, end };
  const location = input.location?.trim();
  if (location) event.location = location;
  const source = input.url?.trim();
  if (source) event.url = requirePublicHttpUrl(source);
  return event;
}

export function requirePublicHttpUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("Lodge source url must be an http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Lodge source url must be an http(s) URL");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    !hostname.includes(".")
    || hostname === "localhost"
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
    || hostname.includes(":")
  ) {
    throw new Error("Lodge source url must be a public http(s) URL");
  }
  return parsed.toString();
}

export function requireTitle(value: string): string {
  const title = value.replace(/\s+/g, " ").trim();
  if (!title) throw new Error("Lodge event title is required");
  return title;
}

export function toUtcIso(value: string, field: string): string {
  return requireDate(value, field).toISOString();
}

export function isLodgeEventQueryKey(key: string): boolean {
  return EVENT_KEY_PATTERN.test(key);
}

function requireWeekEvents(inputs: readonly CalendarEvent[]): CalendarEvent[] {
  if (inputs.length === 0) throw new Error("Lodge week file needs at least one event");
  if (inputs.length > MAX_WEEK_EVENTS) {
    throw new Error(`Lodge week file is limited to ${MAX_WEEK_EVENTS} events`);
  }
  return inputs.map((input) => pickCalendarEvent(input));
}

function requireDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid Lodge ${field}`);
  return date;
}

function compactUtc(iso: string): string {
  return toUtcIso(iso, "datetime").replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function eventUid(event: CalendarEvent): string {
  const basis = [event.title, event.start, event.end, event.location ?? "", event.url ?? ""].join("\0");
  const hash = createHash("sha256").update(basis).digest("hex").slice(0, 16);
  // UID host is the existing Pages hostname (not renamed). Product name is Lodge.
  return `${hash}@coursesignal-bzb.pages.dev`;
}

function escapeIcsText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\n")
    .replaceAll("\n", "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let offset = 0;
  let limit = 75;
  while (offset < bytes.length) {
    let end = Math.min(offset + limit, bytes.length);
    while (end > offset && (bytes[end] & 0b1100_0000) === 0b1000_0000) end -= 1;
    parts.push(bytes.subarray(offset, end).toString("utf8"));
    offset = end;
    limit = 74;
  }
  return parts.map((part, index) => (index === 0 ? part : ` ${part}`)).join("\r\n");
}

function asSearchParams(query: string | URLSearchParams): URLSearchParams {
  return typeof query === "string" ? new URLSearchParams(query.replace(/^\?/, "")) : query;
}

function readLodgeFields(params: URLSearchParams, suffix: string): LodgeQueryFields {
  const title = params.get(`title${suffix}`) ?? "";
  const fields: LodgeQueryFields = { title: requireTitle(title) };
  const start = params.get(`start${suffix}`)?.trim();
  const end = params.get(`end${suffix}`)?.trim();
  const location = params.get(`location${suffix}`)?.trim();
  const url = params.get(`url${suffix}`)?.trim();
  if (start) fields.start = toUtcIso(start, "start");
  if (end) fields.end = toUtcIso(end, "end");
  if (location) fields.location = location;
  if (url) fields.url = requirePublicHttpUrl(url);
  return fields;
}
