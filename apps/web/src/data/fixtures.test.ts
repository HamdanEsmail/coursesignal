import { describe, expect, it } from "vitest";
import { FIRSTROLE_URL, LODGE_REPO_URL, fixtures } from "./fixtures.js";
import { buildIcs, parseEventQuery, toSearchParams } from "../lib/calendar.js";

describe("Lodge fixtures", () => {
  it("keeps only sanitized traces and a FirstRole door", () => {
    expect(FIRSTROLE_URL).toBe("https://firstrole.hamdanesmail12-7a9.workers.dev");
    expect(LODGE_REPO_URL).toBe("https://github.com/HamdanEsmail/coursesignal");
    expect(fixtures.map((fixture) => fixture.id)).toEqual(["due-week", "roles-dubai", "form-walk"]);
    const corpus = JSON.stringify(fixtures);
    expect(corpus).not.toMatch(/CourseSignal|STAT 210|\bSOURCES\b|\bWATCH\b|\+\d{8,}|@gmail\.com/i);
    expect(corpus).not.toMatch(/conversation|chat_id|imessage/i);
  });

  it("includes a roles fixture with 1–3 listings and an unverified line", () => {
    const roles = fixtures.find((fixture) => fixture.id === "roles-dubai");
    expect(roles?.roles).toHaveLength(3);
    expect(roles?.roles?.some((listing) => listing.openness === "open")).toBe(true);
    expect(roles?.roles?.some((listing) => listing.openness === "unverified")).toBe(true);
    expect(roles?.steps.some((step) => step.endpoint === "agent" && step.status === "complete")).toBe(
      true,
    );
  });

  it("can host the due-week events on /slip and /add.ics without identity fields", () => {
    const due = fixtures[0]!;
    const params = toSearchParams(due.events);
    expect(params.toString()).not.toMatch(/(?:^|&)(?:phone|name|conversation)=/i);
    const parsed = parseEventQuery(params);
    expect(parsed).toHaveLength(2);
    expect(buildIcs(parsed)).toContain("SUMMARY:Econ problem set");
  });

  it("records Search / Fetch / Agent timings for #judge", () => {
    for (const fixture of fixtures) {
      expect(fixture.steps.length).toBeGreaterThan(1);
      expect(fixture.steps.every((step) => step.ms >= 0)).toBe(true);
      expect(fixture.asked.length).toBeGreaterThan(8);
    }
  });
});
