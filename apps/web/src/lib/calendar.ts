export type LodgeEvent = {
  title: string;
  start?: string;
  end?: string;
  where?: string;
  url?: string;
  notes?: string;
  allDay?: boolean;
  tz?: string;
};

export type ParseEventOptions = {
  /** Calendar /add.ics needs a start. Slip cards may be title + source url only. */
  requireStart?: boolean;
};

/** Shared with the bridge: title, start, end, location, url. One event is unsuffixed; a week file uses title0 / location0. */
export const LODGE_ICS_QUERY_HINT =
  "Lodge needs event fields: title and start, or title0 and start0.";

export const FORBIDDEN_QUERY_KEYS = [
  "phone",
  "tel",
  "msisdn",
  "from",
  "to",
  "name",
  "names",
  "conversation",
  "conversation_id",
  "conversationid",
  "chat",
  "chat_id",
  "chatid",
  "handle",
  "identity",
  "email",
  "student",
  "user",
  "token",
  "key",
  "secret",
  "otp",
  "imessage",
  "who",
  "sender",
  "uid",
] as const;

const FORBIDDEN = new Set<string>(FORBIDDEN_QUERY_KEYS);

const INDEXED =
  /^(?:e)?(\d+)\.(title|text|start|dtstart|end|dtend|where|location|url|source|notes|details|description|allday|tz)$/i;
const SUFFIXED =
  /^(title|text|start|dtstart|end|dtend|where|location|url|source|notes|details|description|allday|tz)(\d+)$/i;

const FIELD_ALIASES: Record<string, keyof LodgeEvent | "allDay"> = {
  title: "title",
  text: "title",
  start: "start",
  dtstart: "start",
  end: "end",
  dtend: "end",
  where: "where",
  location: "where",
  url: "url",
  source: "url",
  notes: "notes",
  details: "notes",
  description: "notes",
  allday: "allDay",
  tz: "tz",
};

export function isForbiddenQueryKey(key: string): boolean {
  return FORBIDDEN.has(key.trim().toLowerCase());
}

export function parseEventQuery(
  params: URLSearchParams,
  options: ParseEventOptions = {},
): LodgeEvent[] {
  const requireStart = options.requireStart !== false;
  const indexed = new Map<number, Partial<LodgeEvent>>();

  for (const [rawKey, value] of params.entries()) {
    const key = rawKey.trim();
    if (!key || isForbiddenQueryKey(key)) continue;

    const indexedMatch = key.match(INDEXED);
    if (indexedMatch) {
      writeField(indexed, Number(indexedMatch[1]), indexedMatch[2] ?? "", value);
      continue;
    }

    const suffixMatch = key.match(SUFFIXED);
    if (suffixMatch) {
      writeField(indexed, Number(suffixMatch[2]), suffixMatch[1] ?? "", value);
    }
  }

  const fromIndex = [...indexed.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, partial]) => finalizeEvent(partial, requireStart))
    .filter((event): event is LodgeEvent => event !== null);

  if (fromIndex.length > 0) return fromIndex;

  const titles = [...params.getAll("title"), ...params.getAll("text")];
  const starts = [...params.getAll("start"), ...params.getAll("dtstart")];
  const ends = [...params.getAll("end"), ...params.getAll("dtend")];
  const wheres = [...params.getAll("where"), ...params.getAll("location")];
  const urls = [...params.getAll("url"), ...params.getAll("source")];
  const notes = [...params.getAll("notes"), ...params.getAll("details"), ...params.getAll("description")];

  if (titles.length > 1 && titles.length === starts.length) {
    return titles
      .map((title, index) =>
        finalizeEvent(
          collectFields({
            title,
            start: starts[index],
            end: ends[index],
            where: wheres[index],
            url: urls[index],
            notes: notes[index],
            allDay: truthy(params.get("allday")),
            tz: params.get("tz") ?? undefined,
          }),
          requireStart,
        ),
      )
      .filter((event): event is LodgeEvent => event !== null);
  }

  const single = finalizeEvent(
    collectFields({
      title: titles[0],
      start: starts[0],
      end: ends[0],
      where: wheres[0],
      url: urls[0],
      notes: notes[0],
      allDay: truthy(params.get("allday")),
      tz: params.get("tz") ?? undefined,
    }),
    requireStart,
  );

  return single ? [single] : [];
}

export function parseSlipQuery(params: URLSearchParams): LodgeEvent[] {
  return parseEventQuery(params, { requireStart: false });
}

export function toSearchParams(events: LodgeEvent[]): URLSearchParams {
  const params = new URLSearchParams();
  if (events.length === 1 && events[0]) {
    writeEventParams(params, events[0]);
    return params;
  }
  events.forEach((event, index) => writeEventParams(params, event, String(index)));
  return params;
}

export function icsPath(events: LodgeEvent[]): string {
  return `/add.ics?${toSearchParams(events).toString()}`;
}

export function slipPath(events: LodgeEvent[]): string {
  return `/slip?${toSearchParams(events).toString()}`;
}

export function addPath(events: LodgeEvent[]): string {
  return `/add?${toSearchParams(events).toString()}`;
}

export function buildIcs(events: LodgeEvent[], stamped = new Date()): string {
  const dtstamp = formatUtcStamp(stamped);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lodge//Companion//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Lodge",
  ];

  for (const event of events) {
    const start = parseWhen(event.start ?? "");
    if (!start) continue;
    const end = parseWhen(event.end ?? "") ?? defaultEnd(start, event.allDay || start.allDay);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${contentUid(event)}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(formatDateLine("DTSTART", start, event.tz));
    lines.push(formatDateLine("DTEND", end, event.tz));
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.where) lines.push(`LOCATION:${escapeText(event.where)}`);
    if (event.notes) lines.push(`DESCRIPTION:${escapeText(event.notes)}`);
    if (event.url) lines.push(`URL:${escapeText(event.url)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

export function googleTemplateUrl(event: LodgeEvent): string {
  const start = parseWhen(event.start ?? "");
  if (!start) return "https://calendar.google.com/calendar/render?action=TEMPLATE";
  const end = parseWhen(event.end ?? "") ?? defaultEnd(start, event.allDay || start.allDay);
  const dates = `${compact(start)}/${compact(end)}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates,
  });
  if (event.where) params.set("location", event.where);
  if (event.notes) params.set("details", event.notes);
  if (event.url) params.set("sprop", event.url);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

type ParsedWhen = {
  stamp: string;
  allDay: boolean;
  utc: boolean;
};

function writeField(
  bucket: Map<number, Partial<LodgeEvent>>,
  index: number,
  rawField: string,
  value: string,
) {
  const field = FIELD_ALIASES[rawField.toLowerCase()];
  if (!field) return;
  const current = bucket.get(index) ?? {};
  if (field === "allDay") {
    current.allDay = truthy(value);
  } else {
    current[field] = value;
  }
  bucket.set(index, current);
}

function writeEventParams(params: URLSearchParams, event: LodgeEvent, suffix = "") {
  params.set(`title${suffix}`, event.title);
  if (event.start) params.set(`start${suffix}`, event.start);
  if (event.end) params.set(`end${suffix}`, event.end);
  if (event.where) params.set(`location${suffix}`, event.where);
  if (event.url) params.set(`url${suffix}`, event.url);
  if (event.notes) params.set(`notes${suffix}`, event.notes);
  if (event.allDay) params.set(`allday${suffix}`, "1");
  if (event.tz) params.set(`tz${suffix}`, event.tz);
}

function collectFields(input: {
  title?: string | undefined;
  start?: string | undefined;
  end?: string | undefined;
  where?: string | undefined;
  url?: string | undefined;
  notes?: string | undefined;
  allDay?: boolean | undefined;
  tz?: string | undefined;
}): Partial<LodgeEvent> {
  const next: Partial<LodgeEvent> = {};
  if (input.title) next.title = input.title;
  if (input.start) next.start = input.start;
  if (input.end) next.end = input.end;
  if (input.where) next.where = input.where;
  if (input.url) next.url = input.url;
  if (input.notes) next.notes = input.notes;
  if (input.allDay) next.allDay = true;
  if (input.tz) next.tz = input.tz;
  return next;
}

function finalizeEvent(partial: Partial<LodgeEvent>, requireStart = true): LodgeEvent | null {
  const title = partial.title?.trim() ?? "";
  if (!title) return null;
  const start = partial.start?.trim() ?? "";
  if (start && !parseWhen(start)) return null;
  if (requireStart && !start) return null;
  const event: LodgeEvent = { title };
  if (start) event.start = start;
  const end = partial.end?.trim();
  const where = partial.where?.trim();
  const url = sanitizeUrl(partial.url);
  const notes = partial.notes?.trim();
  const tz = sanitizeTz(partial.tz);
  if (end) event.end = end;
  if (where) event.where = where;
  if (url) event.url = url;
  if (notes) event.notes = notes;
  if (partial.allDay) event.allDay = true;
  if (tz) event.tz = tz;
  return event;
}

function sanitizeUrl(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function sanitizeTz(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!/^[A-Za-z]+(?:[_/][A-Za-z0-9+\-]+)+$/.test(trimmed)) return undefined;
  return trimmed;
}

function truthy(value: string | null): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "allday"].includes(value.trim().toLowerCase());
}

export function parseWhen(value: string): ParsedWhen | null {
  const raw = value.trim();
  if (!raw) return null;

  const dateOnly = raw.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (dateOnly) {
    return { stamp: `${dateOnly[1]}${dateOnly[2]}${dateOnly[3]}`, allDay: true, utc: false };
  }

  const compactStamp = raw.match(/^(\d{8}T\d{6})(Z)?$/i);
  if (compactStamp) {
    return {
      stamp: compactStamp[1]?.toUpperCase() ?? "",
      allDay: false,
      utc: Boolean(compactStamp[2]),
    };
  }

  const iso = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (!iso) return null;
  const second = iso[6] ?? "00";
  const stamp = `${iso[1]}${iso[2]}${iso[3]}T${iso[4]}${iso[5]}${second}`;
  const offset = iso[8];
  return { stamp, allDay: false, utc: offset === "Z" };
}

function defaultEnd(start: ParsedWhen, allDay?: boolean): ParsedWhen {
  if (allDay || start.allDay) {
    return { stamp: shiftDate(start.stamp.slice(0, 8), 1), allDay: true, utc: false };
  }
  return { stamp: shiftHour(start.stamp), allDay: false, utc: start.utc };
}

function shiftDate(yyyymmdd: string, days: number): string {
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return [
    next.getUTCFullYear().toString().padStart(4, "0"),
    (next.getUTCMonth() + 1).toString().padStart(2, "0"),
    next.getUTCDate().toString().padStart(2, "0"),
  ].join("");
}

function shiftHour(stamp: string): string {
  const match = stamp.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (!match) return stamp;
  const next = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]) + 1,
      Number(match[5]),
      Number(match[6]),
    ),
  );
  return [
    next.getUTCFullYear().toString().padStart(4, "0"),
    (next.getUTCMonth() + 1).toString().padStart(2, "0"),
    next.getUTCDate().toString().padStart(2, "0"),
    "T",
    next.getUTCHours().toString().padStart(2, "0"),
    next.getUTCMinutes().toString().padStart(2, "0"),
    next.getUTCSeconds().toString().padStart(2, "0"),
  ].join("");
}

function formatDateLine(field: "DTSTART" | "DTEND", when: ParsedWhen, tz?: string): string {
  if (when.allDay) return `${field};VALUE=DATE:${when.stamp.slice(0, 8)}`;
  if (when.utc) return `${field}:${when.stamp}Z`;
  if (tz) return `${field};TZID=${tz}:${when.stamp}`;
  return `${field}:${when.stamp}`;
}

function formatUtcStamp(date: Date): string {
  return [
    date.getUTCFullYear().toString().padStart(4, "0"),
    (date.getUTCMonth() + 1).toString().padStart(2, "0"),
    date.getUTCDate().toString().padStart(2, "0"),
    "T",
    date.getUTCHours().toString().padStart(2, "0"),
    date.getUTCMinutes().toString().padStart(2, "0"),
    date.getUTCSeconds().toString().padStart(2, "0"),
    "Z",
  ].join("");
}

function compact(when: ParsedWhen): string {
  return when.allDay ? when.stamp.slice(0, 8) : `${when.stamp}${when.utc ? "Z" : ""}`;
}

function escapeText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  if (rest) parts.push(` ${rest}`);
  return parts.join("\r\n");
}

function contentUid(event: LodgeEvent): string {
  const basis = `${event.title}|${event.start ?? ""}|${event.end ?? ""}|${event.url ?? ""}`;
  let hash = 2166136261;
  for (const char of basis) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `lodge-${hex}@coursesignal-bzb.pages.dev`;
}
