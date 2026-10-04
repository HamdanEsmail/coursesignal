import { describe, expect, it } from "vitest";
import {
  ADD_TO_CALENDAR_LABEL,
  LODGE_PAGES_ORIGIN,
  LODGE_WEEK_FILE_LABEL,
  MAX_WEEK_EVENTS,
  buildGoogleCalendarTemplateUrl,
  buildIcsBody,
  buildLodgeIcsUrl,
  buildLodgeWeekIcsUrl,
  formatEventLabel,
  isLodgeEventQueryKey,
  namedGoogleCalendarLink,
  namedLodgeIcsLink,
  namedLodgeWeekIcsLink,
  parseLodgeEventQuery,
  type CalendarEvent,
} from "./calendar.js";

const TIME_ZONE = "Asia/Dubai";
const NOW = new Date("2026-10-04T03:45:00.000Z");

const FLU: CalendarEvent = {
  title: "Flu clinic",
  start: "2026-10-08T08:00:00.000Z",
  end: "2026-10-08T09:00:00.000Z",
  location: "Health Center",
  url: "https://health.example.edu/flu",
};

const OFFICE: CalendarEvent = {
  title: "Office hours",
  start: "2026-10-08T10:00:00.000Z",
  end: "2026-10-08T11:00:00.000Z",
  location: "Building A, Room 12",
  url: "https://econ.example.edu/hours",
};

const IDENTITY = {
  conversationKey: "cafef00dconversation-key-9f3a",
  phone: "+971500000000",
  personName: "Amina Al-Hashimi",
  senderKey: "sender-amina-hash",
};

function dirtyEvent(event: CalendarEvent): CalendarEvent {
  return {
    ...event,
    conversationKey: IDENTITY.conversationKey,
    phone: IDENTITY.phone,
    name: IDENTITY.personName,
    senderKey: IDENTITY.senderKey,
    source: IDENTITY.phone,
  } as CalendarEvent;
}

function assertNoIdentity(value: string): void {
  expect(value).not.toContain(IDENTITY.conversationKey);
  expect(value).not.toContain(IDENTITY.phone);
  expect(value).not.toContain("971500000000");
  expect(value).not.toContain(IDENTITY.personName);
  expect(value).not.toMatch(/Amina/i);
  expect(value).not.toMatch(/Al-Hashimi/i);
  expect(value).not.toContain(IDENTITY.senderKey);
  expect(value).not.toMatch(/conversationKey/i);
  expect(value).not.toMatch(/(?:^|[?&])phone=/i);
}

function assertNamedHelperText(label: string): void {
  expect(label).not.toContain("?");
  expect(label).not.toContain("add.ics");
  expect(label).not.toContain("start=");
  expect(label).not.toContain("title=");
  expect(label).not.toContain("calendar.google.com");
  expect(label).not.toMatch(/CourseSignal/i);
}

function lodgeQueryKeys(url: string): string[] {
  return [...new URL(url).searchParams.keys()];
}

describe("formatEventLabel", () => {
  it("names the event like Flu clinic · Thu 12:00 in local time", () => {
    expect(formatEventLabel(FLU, TIME_ZONE)).toBe("Flu clinic · Thu 12:00");
  });
});

describe("Google Calendar TEMPLATE", () => {
  it("builds a TEMPLATE URL from event fields only", () => {
    const url = buildGoogleCalendarTemplateUrl(FLU);
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe("https://calendar.google.com/calendar/render");
    expect(parsed.searchParams.get("action")).toBe("TEMPLATE");
    expect(parsed.searchParams.get("text")).toBe("Flu clinic");
    expect(parsed.searchParams.get("dates")).toBe("20261008T080000Z/20261008T090000Z");
    expect(parsed.searchParams.get("location")).toBe("Health Center");
    expect(parsed.searchParams.get("details")).toBe("https://health.example.edu/flu");
    expect([...parsed.searchParams.keys()].sort()).toEqual(["action", "dates", "details", "location", "text"]);
  });

  it("uses Add to calendar · Flu clinic · Thu 12:00 as helper text, not a query dump", () => {
    const link = namedGoogleCalendarLink(FLU, { timeZone: TIME_ZONE });
    expect(ADD_TO_CALENDAR_LABEL).toBe("Add to calendar");
    expect(link.label).toBe("Add to calendar · Flu clinic · Thu 12:00");
    assertNamedHelperText(link.label);
    expect(link.url).toContain("action=TEMPLATE");
  });
});

describe("Lodge hosted ICS URL", () => {
  it("points at the existing Pages /add.ics with allowlisted query fields", () => {
    const url = buildLodgeIcsUrl(FLU);
    expect(url.startsWith(`${LODGE_PAGES_ORIGIN}/add.ics?`)).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("title")).toBe("Flu clinic");
    expect(params.get("start")).toBe("2026-10-08T08:00:00.000Z");
    expect(params.get("end")).toBe("2026-10-08T09:00:00.000Z");
    expect(params.get("location")).toBe("Health Center");
    expect(params.get("url")).toBe("https://health.example.edu/flu");
    expect(lodgeQueryKeys(url).every(isLodgeEventQueryKey)).toBe(true);
  });

  it("names the Add to calendar link instead of dumping the query string", () => {
    const link = namedLodgeIcsLink(FLU, { timeZone: TIME_ZONE });
    expect(link.label).toBe("Add to calendar · Flu clinic · Thu 12:00");
    assertNamedHelperText(link.label);
    expect(link.url).toContain("/add.ics?");
  });
});

describe("Lodge week file", () => {
  it("encodes several VEVENTs with indexed title/start/end/location/url keys", () => {
    const url = buildLodgeWeekIcsUrl([FLU, OFFICE]);
    expect(url.startsWith(`${LODGE_PAGES_ORIGIN}/add.ics?`)).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("title0")).toBe("Flu clinic");
    expect(params.get("start0")).toBe("2026-10-08T08:00:00.000Z");
    expect(params.get("end0")).toBe("2026-10-08T09:00:00.000Z");
    expect(params.get("location0")).toBe("Health Center");
    expect(params.get("url0")).toBe("https://health.example.edu/flu");
    expect(params.get("title1")).toBe("Office hours");
    expect(params.get("start1")).toBe("2026-10-08T10:00:00.000Z");
    expect(params.get("end1")).toBe("2026-10-08T11:00:00.000Z");
    expect(params.has("title")).toBe(false);
    expect(lodgeQueryKeys(url).every(isLodgeEventQueryKey)).toBe(true);
    expect(parseLodgeEventQuery(params).map((event) => event.title)).toEqual([
      "Flu clinic",
      "Office hours",
    ]);
  });

  it("names the week file instead of listing raw URLs", () => {
    const link = namedLodgeWeekIcsLink([FLU, OFFICE]);
    expect(LODGE_WEEK_FILE_LABEL).toBe("Lodge week file");
    expect(link.label).toBe("Lodge week file · 2 events");
    assertNamedHelperText(link.label);
    expect(link.label).not.toMatch(/CourseSignal/i);
  });
});

describe("ICS body", () => {
  it("renders one Lodge VEVENT from event fields", () => {
    const ics = buildIcsBody(FLU, { now: NOW });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("PRODID:-//Lodge//Calendar//EN");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("SUMMARY:Flu clinic");
    expect(ics).toContain("DTSTART:20261008T080000Z");
    expect(ics).toContain("DTEND:20261008T090000Z");
    expect(ics).toContain("LOCATION:Health Center");
    expect(ics).toContain("URL:https://health.example.edu/flu");
    expect(ics).toContain("DTSTAMP:20261004T034500Z");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).not.toContain("ATTENDEE");
    expect(ics).not.toContain("ORGANIZER");
    expect(ics).toContain("PRODID:-//Lodge//Calendar//EN");
  });

  it("renders a Lodge week file with several VEVENTs", () => {
    const ics = buildIcsBody([FLU, OFFICE], { now: NOW });
    expect(ics).toContain("X-WR-CALNAME:Lodge week file");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("SUMMARY:Flu clinic");
    expect(ics).toContain("SUMMARY:Office hours");
    expect(ics).toContain("LOCATION:Building A\\, Room 12");
  });
});

describe("privacy", () => {
  it("never puts conversation keys, phones, or names of people on calendar URLs or ICS", () => {
    const dirty = dirtyEvent(FLU);
    const dirtyWeek = [dirty, dirtyEvent(OFFICE)];
    const surfaces = [
      buildGoogleCalendarTemplateUrl(dirty),
      buildLodgeIcsUrl(dirty),
      buildLodgeWeekIcsUrl(dirtyWeek),
      buildIcsBody(dirty, { now: NOW }),
      buildIcsBody(dirtyWeek, { now: NOW }),
      namedGoogleCalendarLink(dirty, { timeZone: TIME_ZONE }).label,
      namedLodgeIcsLink(dirty, { timeZone: TIME_ZONE }).label,
      namedLodgeWeekIcsLink(dirtyWeek).label,
    ];
    for (const surface of surfaces) {
      assertNoIdentity(surface);
    }
    const lodgeUrl = new URL(buildLodgeIcsUrl(dirty));
    expect([...lodgeUrl.searchParams.keys()].sort()).toEqual([
      "end",
      "location",
      "start",
      "title",
      "url",
    ]);
    const googleUrl = new URL(buildGoogleCalendarTemplateUrl(dirty));
    expect(googleUrl.searchParams.has("conversationKey")).toBe(false);
    expect(googleUrl.searchParams.has("phone")).toBe(false);
    expect(googleUrl.searchParams.has("name")).toBe(false);
  });
});

describe("validation", () => {
  it("rejects inverted times, empty titles, and non-public source urls", () => {
    expect(() => buildLodgeIcsUrl({ ...FLU, end: FLU.start })).toThrow(/end must be after start/);
    expect(() => buildLodgeIcsUrl({ ...FLU, title: "  " })).toThrow(/title is required/);
    expect(() => buildLodgeIcsUrl({ ...FLU, url: "javascript:alert(1)" })).toThrow(/source url/);
    expect(() => buildLodgeWeekIcsUrl([])).toThrow(/week file/);
    expect(() => buildLodgeWeekIcsUrl(Array.from({ length: MAX_WEEK_EVENTS + 1 }, () => FLU))).toThrow(
      /limited to 20/,
    );
  });
});
