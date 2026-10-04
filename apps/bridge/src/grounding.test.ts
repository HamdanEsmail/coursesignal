import { describe, expect, it } from "vitest";
import {
  claimIsCited,
  createTraceId,
  extractClaims,
  findSourceDisagreements,
  formatDisagreement,
  formatHumanLocalTime,
  groundReply,
  type CitedToolResult,
} from "./grounding.js";

const syllabus: CitedToolResult = {
  traceId: "T1",
  tool: "fetch",
  title: "syllabus",
  url: "https://econ.example.edu/syllabus",
  text: "The problem set is due end of week.",
};

const calendar: CitedToolResult = {
  traceId: "T2",
  tool: "fetch",
  title: "calendar",
  url: "https://econ.example.edu/calendar",
  text: "The problem set is due Friday.",
};

const clinic: CitedToolResult = {
  traceId: "T1",
  tool: "search",
  title: "Health",
  url: "https://health.example.edu/flu",
  text: "Flu clinic Thursday 10:00. Still open.",
};

describe("createTraceId", () => {
  it("assigns 1-based T ids", () => {
    expect(createTraceId(1)).toBe("T1");
    expect(createTraceId(12)).toBe("T12");
    expect(() => createTraceId(0)).toThrow(/1-based/i);
  });
});

describe("groundReply", () => {
  it("accepts dates, times, and still-open when they appear in a cited tool result", () => {
    const result = groundReply("Flu clinic Thursday 10:00. Still open.", [clinic]);
    expect(result.hedged).toBe(false);
    expect(result.hedges).toEqual([]);
    expect(result.text).toContain("Thursday 10:00");
    expect(result.citations[0]?.traceId).toBe("T1");
  });

  it("hedges dates, times, and still-open that are missing from tool results", () => {
    const result = groundReply("Due Friday 18:00 and still open.", [clinic]);
    expect(result.hedged).toBe(true);
    expect(result.hedges).toEqual(expect.arrayContaining([
      "I couldn't confirm that date on a checked page.",
      "I couldn't confirm that time on a checked page.",
    ]));
    expect(result.text).toMatch(/couldn't confirm/i);
  });

  it("reports both sides when sources disagree and does not pick a winner", () => {
    const disagreements = findSourceDisagreements([syllabus, calendar]);
    expect(disagreements).toHaveLength(1);
    expect(disagreements[0]?.kind).toBe("date");
    expect(disagreements[0]?.left.value).toBe("end of week");
    expect(disagreements[0]?.right.value).toBe("friday");
    const formatted = formatDisagreement(disagreements[0]!);
    expect(formatted).toContain("https://econ.example.edu/syllabus");
    expect(formatted).toContain("https://econ.example.edu/calendar");
    expect(formatted).toMatch(/I have not picked a winner/);
    const result = groundReply("The problem set deadline is soon.", [syllabus, calendar]);
    expect(result.disagreements).toHaveLength(1);
    expect(result.text).toMatch(/end of week/);
    expect(result.text).toMatch(/friday/);
    expect(result.text).toMatch(/I have not picked a winner/);
  });

  it("reports both still-open statuses when they conflict", () => {
    const open: CitedToolResult = {
      ...clinic,
      text: "The listing is still open.",
    };
    const closed: CitedToolResult = {
      traceId: "T2",
      tool: "agent",
      title: "portal",
      url: "https://careers.example.edu/intern",
      text: "status: closed",
    };
    const result = groundReply("I checked the listing.", [open, closed]);
    expect(result.disagreements.some((item) => item.kind === "still_open")).toBe(true);
    expect(result.text).toMatch(/open/);
    expect(result.text).toMatch(/closed/);
    expect(result.text).toMatch(/I have not picked a winner/);
  });

  it("treats EOW as the same deadline as end of week", () => {
    expect(claimIsCited(
      extractClaims("due EOW")[0]!,
      [{ ...syllabus, text: "due end of week" }],
    )).toBe(true);
    expect(findSourceDisagreements([
      { ...syllabus, text: "due EOW" },
      { ...calendar, text: "due end of week" },
    ])).toEqual([]);
  });
});

describe("formatHumanLocalTime", () => {
  const now = new Date("2026-10-04T08:00:00.000Z");

  it("uses Today and Tomorrow in the student's timezone", () => {
    expect(formatHumanLocalTime("2026-10-04T14:00:00.000Z", "Asia/Dubai", now)).toBe("Today, 18:00");
    expect(formatHumanLocalTime("2026-10-05T14:00:00.000Z", "Asia/Dubai", now)).toBe("Tomorrow, 18:00");
    expect(formatHumanLocalTime("2026-10-08T06:00:00.000Z", "Asia/Dubai", now)).toMatch(/8 Oct, 10:00/);
  });
});
