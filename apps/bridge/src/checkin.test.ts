import { describe, expect, it } from "vitest";
import {
  applyCheckInAnswer,
  beginCheckIn,
  checkInPrompt,
  extractCity,
  inferTimezone,
  isSkipText,
  looksLikeCheckInInterrupt,
} from "./checkin.js";
import { LODGE_DEFAULT_TIMEZONE, type ConversationMemory } from "./types.js";

const NOW = new Date("2026-10-04T08:00:00.000Z");

function memory(): ConversationMemory {
  return beginCheckIn({
    courses: [],
    watches: [],
    updatedAt: NOW.toISOString(),
  }, NOW);
}

describe("Lodge check-in", () => {
  it("starts on school and skip walks every optional step", () => {
    let state = memory();
    expect(state.checkInStep).toBe("school");
    expect(checkInPrompt("school")).toMatch(/school/i);
    expect(checkInPrompt("school")).not.toMatch(/CourseSignal|STAT 210/i);

    for (const expected of ["course_page", "events_page", "roles", "done"] as const) {
      const result = applyCheckInAnswer(state, "skip", NOW);
      expect(result.kind).toBe("consumed");
      if (result.kind !== "consumed") return;
      state = result.memory;
      expect(state.checkInStep).toBe(expected);
    }
    expect(state.checkInCompletedAt).toBe(NOW.toISOString());
    expect(state.timezone).toBe(LODGE_DEFAULT_TIMEZONE);
  });

  it("records school timezone, course page, events page, and roles city", () => {
    let state = memory();
    const school = applyCheckInAnswer(state, "NYU Abu Dhabi", NOW);
    expect(school.kind).toBe("consumed");
    if (school.kind !== "consumed") return;
    expect(school.memory.school).toBe("NYU Abu Dhabi");
    expect(school.memory.timezone).toBe("Asia/Dubai");
    state = school.memory;

    const course = applyCheckInAnswer(state, "https://econ.example.edu/syllabus", NOW);
    expect(course.kind).toBe("consumed");
    if (course.kind !== "consumed") return;
    expect(course.memory.savedLinks?.some((link) => link.kind === "course")).toBe(true);
    state = course.memory;

    const events = applyCheckInAnswer(state, "https://events.example.edu/week", NOW);
    expect(events.kind).toBe("consumed");
    if (events.kind !== "consumed") return;
    expect(events.memory.savedLinks?.some((link) => link.kind === "events")).toBe(true);
    state = events.memory;

    const roles = applyCheckInAnswer(state, "internships in Dubai", NOW);
    expect(roles.kind).toBe("consumed");
    if (roles.kind !== "consumed") return;
    expect(roles.memory.rolesCity).toBe("Dubai");
    expect(roles.memory.rolesOptIn).toBe(true);
    expect(roles.memory.checkInStep).toBe("done");
    expect(roles.reply).not.toMatch(/CourseSignal|STAT 210/i);
  });

  it("interrupts school when the student asks a question instead", () => {
    const state = memory();
    expect(looksLikeCheckInInterrupt("what's due this week", "school")).toBe(true);
    const result = applyCheckInAnswer(state, "what's due this week", NOW);
    expect(result.kind).toBe("interrupt");
    if (result.kind !== "interrupt") return;
    expect(result.memory.checkInStep).toBe("done");
  });

  it("maps skip aliases and infers city", () => {
    expect(isSkipText("SKIP")).toBe(true);
    expect(isSkipText("none")).toBe(true);
    expect(inferTimezone("Asia/Dubai")).toBe("Asia/Dubai");
    expect(extractCity("internships in Dubai")).toBe("Dubai");
  });
});
