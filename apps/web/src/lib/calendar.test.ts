import { describe, expect, it } from "vitest";
import {
  buildIcs,
  googleTemplateUrl,
  icsPath,
  isForbiddenQueryKey,
  parseEventQuery,
  parseSlipQuery,
  slipPath,
  toSearchParams,
} from "./calendar.js";

const week = [
  {
    title: "Econ problem set",
    start: "2026-10-10T17:00:00",
    end: "2026-10-10T17:00:00",
    where: "Saved page dropbox",
    url: "https://openstax.org/details/books/principles-economics-3e",
    notes: "Calendar child: Friday 17:00.",
  },
  {
    title: "Econ office hours",
    start: "2026-10-09T15:00:00",
    end: "2026-10-09T16:00:00",
    where: "Baker 102",
  },
];

describe("parseEventQuery", () => {
  it("reads a single event from title and start", () => {
    const events = parseEventQuery(
      new URLSearchParams("title=Office+hours&start=2026-10-09T15:00:00&where=Baker+102"),
    );
    expect(events).toEqual([
      {
        title: "Office hours",
        start: "2026-10-09T15:00:00",
        where: "Baker 102",
      },
    ]);
  });

  it("reads a week from indexed event fields", () => {
    const events = parseEventQuery(toSearchParams(week));
    expect(events.map((event) => event.title)).toEqual(["Econ problem set", "Econ office hours"]);
  });

  it("reads a bridge slip that uses location instead of where", () => {
    const events = parseEventQuery(
      new URLSearchParams(
        "title=Flu+clinic&start=2026-10-08T08:00:00.000Z&end=2026-10-08T09:00:00.000Z&location=Health+Center&url=https://health.example.edu/flu",
      ),
    );
    expect(events).toEqual([
      {
        title: "Flu clinic",
        start: "2026-10-08T08:00:00.000Z",
        end: "2026-10-08T09:00:00.000Z",
        where: "Health Center",
        url: "https://health.example.edu/flu",
      },
    ]);
  });

  it("reads a Lodge week encoded as title0/location0", () => {
    const events = parseEventQuery(
      new URLSearchParams(
        "title0=Flu+clinic&start0=2026-10-08T08:00:00.000Z&end0=2026-10-08T09:00:00.000Z&location0=Health+Center&title1=Office+hours&start1=2026-10-08T10:00:00.000Z&end1=2026-10-08T11:00:00.000Z&location1=Building+A",
      ),
    );
    expect(events.map((event) => ({ title: event.title, where: event.where }))).toEqual([
      { title: "Flu clinic", where: "Health Center" },
      { title: "Office hours", where: "Building A" },
    ]);
  });

  it("still reads the older e0.title/where aliases", () => {
    const events = parseEventQuery(
      new URLSearchParams("e0.title=Office+hours&e0.start=2026-10-09T15:00:00&e0.where=Baker+102"),
    );
    expect(events).toEqual([
      {
        title: "Office hours",
        start: "2026-10-09T15:00:00",
        where: "Baker 102",
      },
    ]);
  });

  it("opens a title-only bridge slip on /slip without treating it as calendar", () => {
    const params = new URLSearchParams(
      "title=Housing+application&url=https://housing.example.edu/apply",
    );
    expect(parseEventQuery(params)).toEqual([]);
    expect(parseSlipQuery(params)).toEqual([
      {
        title: "Housing application",
        url: "https://housing.example.edu/apply",
      },
    ]);
  });

  it("ignores conversation keys, phones, and names", () => {
    const params = new URLSearchParams(
      "title=Office+hours&start=2026-10-09T15:00:00&phone=%2B15555550100&name=Sam&conversation=abc&chat_id=99&uid=secret",
    );
    const events = parseEventQuery(params);
    expect(events).toHaveLength(1);
    expect(events[0]?.title).toBe("Office hours");
    expect(buildIcs(events)).not.toMatch(/\+15555550100|Sam|abc|secret/i);
  });

  it("drops javascript URLs", () => {
    const events = parseEventQuery(
      new URLSearchParams("title=Talk&start=2026-10-09&url=javascript:alert(1)"),
    );
    expect(events[0]?.url).toBeUndefined();
  });
});

describe("buildIcs", () => {
  it("emits text/calendar VEVENTs with Lodge prodid and no identity fields", () => {
    const ics = buildIcs(week, new Date("2026-10-04T07:00:00Z"));
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("PRODID:-//Lodge//Companion//EN");
    expect(ics).toContain("SUMMARY:Econ problem set");
    expect(ics).toContain("SUMMARY:Econ office hours");
    expect(ics).toContain("LOCATION:Baker 102");
    expect(ics).toContain("DTSTART:20261010T170000");
    expect(ics.replaceAll("coursesignal-bzb.pages.dev", "")).not.toMatch(
      /CourseSignal|STAT 210|\bphone=|\bconversation=/i,
    );
    expect(ics).toContain("UID:lodge-");
    expect(ics).toContain("@coursesignal-bzb.pages.dev");
    expect(ics.split("BEGIN:VEVENT")).toHaveLength(3);
  });

  it("treats a date-only start as an all-day event", () => {
    const ics = buildIcs([{ title: "Window closes", start: "2026-10-10", allDay: true }]);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261010");
    expect(ics).toContain("DTEND;VALUE=DATE:20261011");
  });
});

describe("hosted paths", () => {
  it("keeps /slip and /add.ics on query-string event fields only", () => {
    const path = icsPath(week);
    expect(path.startsWith("/add.ics?")).toBe(true);
    expect(path).toContain("title0=Econ+problem+set");
    expect(path).toContain("location0=Saved+page+dropbox");
    expect(path).toContain("location1=Baker+102");
    expect(path).not.toContain("e0.title");
    expect(path).not.toMatch(/(?:^|\?|&)where=/);
    expect(path).not.toMatch(/phone|name|conversation/i);
    expect(slipPath(week).startsWith("/slip?")).toBe(true);
    const single = toSearchParams([week[1]!]);
    expect(single.get("title")).toBe("Econ office hours");
    expect(single.get("location")).toBe("Baker 102");
    expect(single.has("where")).toBe(false);
  });

  it("builds a named Google template for one event", () => {
    const href = googleTemplateUrl(week[1]!);
    expect(href).toContain("action=TEMPLATE");
    expect(href).toContain("text=Econ+office+hours");
    expect(href).toContain("Baker+102");
  });
});

describe("forbidden keys", () => {
  it("names the identity fields Lodge will not copy into a slip", () => {
    expect(isForbiddenQueryKey("phone")).toBe(true);
    expect(isForbiddenQueryKey("title")).toBe(false);
  });
});
