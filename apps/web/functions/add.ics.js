const FORBIDDEN = new Set([
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
]);

const INDEXED =
  /^(?:e)?(\d+)\.(title|text|start|dtstart|end|dtend|where|location|url|source|notes|details|description|allday|tz)$/i;
const SUFFIXED =
  /^(title|text|start|dtstart|end|dtend|where|location|url|source|notes|details|description|allday|tz)(\d+)$/i;

/**
 * Cloudflare Pages Function for GET /add.ics
 * Same Lodge query contract as the bridge: title/start/end/location/url,
 * unsuffixed for one event, title0/location0 for a week file.
 * `where` and e0.title still parse as aliases.
 */
export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const events = parseEventQuery(url.searchParams);
  if (events.length === 0) {
    return new Response("Lodge needs event fields: title and start, or title0 and start0.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(buildIcs(events), {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'attachment; filename="lodge.ics"',
    },
  });
}

function parseEventQuery(params) {
  const indexed = new Map();
  for (const [rawKey, value] of params.entries()) {
    const key = rawKey.trim();
    if (!key || FORBIDDEN.has(key.toLowerCase())) continue;
    const indexedMatch = key.match(INDEXED);
    const suffixMatch = indexedMatch ? null : key.match(SUFFIXED);
    const index = indexedMatch ? Number(indexedMatch[1]) : suffixMatch ? Number(suffixMatch[2]) : NaN;
    const rawField = indexedMatch?.[2] ?? suffixMatch?.[1];
    if (!rawField || Number.isNaN(index)) continue;
    const field = normalizeField(rawField);
    const current = indexed.get(index) ?? {};
    current[field] = field === "allDay" ? truthy(value) : value;
    indexed.set(index, current);
  }

  const fromIndex = [...indexed.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, partial]) => finalizeEvent(partial))
    .filter(Boolean);
  if (fromIndex.length > 0) return fromIndex;

  return [
    finalizeEvent({
      title: params.get("title") ?? params.get("text"),
      start: params.get("start") ?? params.get("dtstart"),
      end: params.get("end") ?? params.get("dtend"),
      where: params.get("where") ?? params.get("location"),
      url: params.get("url") ?? params.get("source"),
      notes: params.get("notes") ?? params.get("details") ?? params.get("description"),
      allDay: truthy(params.get("allday")),
      tz: params.get("tz"),
    }),
  ].filter(Boolean);
}

function normalizeField(raw) {
  const key = raw.toLowerCase();
  if (key === "text" || key === "title") return "title";
  if (key === "dtstart" || key === "start") return "start";
  if (key === "dtend" || key === "end") return "end";
  if (key === "location" || key === "where") return "where";
  if (key === "source" || key === "url") return "url";
  if (key === "details" || key === "description" || key === "notes") return "notes";
  if (key === "allday") return "allDay";
  return key;
}

function finalizeEvent(partial) {
  const title = String(partial.title ?? "").trim();
  const start = String(partial.start ?? "").trim();
  if (!title || !start) return null;
  return {
    title,
    start,
    end: String(partial.end ?? "").trim() || undefined,
    where: String(partial.where ?? "").trim() || undefined,
    url: sanitizeUrl(partial.url),
    notes: String(partial.notes ?? "").trim() || undefined,
    allDay: Boolean(partial.allDay),
    tz: String(partial.tz ?? "").trim() || undefined,
  };
}

function sanitizeUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function truthy(value) {
  return ["1", "true", "yes", "allday"].includes(String(value ?? "").trim().toLowerCase());
}

function buildIcs(events) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lodge//Companion//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Lodge",
  ];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  for (const event of events) {
    const start = toStamp(event.start, event.allDay);
    const end = event.end ? toStamp(event.end, event.allDay) : start;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:lodge-${hash(event.title + event.start)}@coursesignal-bzb.pages.dev`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(event.allDay || start.length === 8 ? `DTSTART;VALUE=DATE:${start.slice(0, 8)}` : `DTSTART:${start}`);
    lines.push(event.allDay || end.length === 8 ? `DTEND;VALUE=DATE:${end.slice(0, 8)}` : `DTEND:${end}`);
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.where) lines.push(`LOCATION:${escapeText(event.where)}`);
    if (event.notes) lines.push(`DESCRIPTION:${escapeText(event.notes)}`);
    if (event.url) lines.push(`URL:${escapeText(event.url)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

function toStamp(value, allDay) {
  const raw = String(value);
  if (allDay || /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.replaceAll("-", "").slice(0, 8);
  return raw.replaceAll("-", "").replaceAll(":", "").replace(".000", "").replace("Z", "Z");
}

function escapeText(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function hash(value) {
  let next = 2166136261;
  for (const char of value) {
    next ^= char.charCodeAt(0);
    next = Math.imul(next, 16777619);
  }
  return (next >>> 0).toString(16).padStart(8, "0");
}
