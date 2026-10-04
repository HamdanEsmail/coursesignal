import { describe, expect, it } from "vitest";
import {
  addNote,
  clashLine,
  forgetNote,
  markLastOpportunityApplied,
  pinSources,
  showNotes,
  weekEvents,
} from "./notebook.js";
import { LODGE_NOTEBOOK_CAP, type ConversationMemory, type EvidenceSource } from "./types.js";

const NOW = new Date("2026-10-04T08:00:00.000Z");

function memory(): ConversationMemory {
  return {
    courses: [],
    watches: [],
    updatedAt: NOW.toISOString(),
    notebook: [],
  };
}

describe("Lodge notebook", () => {
  it("notes, shows, and forgets lines under the cap", () => {
    const added = addNote(memory(), { text: "Office hours moved to Baker 102" }, NOW);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(showNotes(added.memory)).toMatch(/Office hours moved/);
    expect(showNotes(added.memory)).not.toMatch(/CourseSignal|STAT 210/i);

    const forgotten = forgetNote(added.memory, "office hours");
    expect(forgotten.ok).toBe(true);
    if (!forgotten.ok) return;
    expect(forgotten.memory.notebook).toHaveLength(0);
  });

  it("pins a last list and refuses a 31st line without throwing", () => {
    const sources: EvidenceSource[] = [
      { title: "Flu clinic", url: "https://health.example.edu/flu", excerpt: "Thursday", endpoint: "fetch" },
    ];
    const pinned = pinSources(memory(), sources, NOW);
    expect(pinned.pinned).toBe(1);

    let next = memory();
    for (let i = 0; i < LODGE_NOTEBOOK_CAP; i += 1) {
      const added = addNote(next, { text: `Note ${i + 1}` }, NOW);
      expect(added.ok).toBe(true);
      if (!added.ok) return;
      next = added.memory;
    }
    const overflow = addNote(next, { text: "one more" }, NOW);
    expect(overflow).toEqual({ ok: false, reason: "full" });
  });

  it("marks the last opportunity applied and reports a clash", () => {
    const added = addNote(memory(), {
      text: "Intern Dubai",
      kind: "opportunity",
      company: "Example",
      listingTitle: "Intern",
      url: "https://example.com/jobs/1",
    }, NOW);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const applied = markLastOpportunityApplied(added.memory, NOW);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.note.applied).toBe(true);

    const event = addNote(memory(), {
      text: "Flu clinic",
      kind: "event",
      startsAt: "2026-10-08T08:00:00.000Z",
      endsAt: "2026-10-08T09:00:00.000Z",
    }, NOW);
    expect(event.ok).toBe(true);
    if (!event.ok) return;
    expect(clashLine(event.memory, {
      title: "Office hours",
      start: "2026-10-08T08:30:00.000Z",
      end: "2026-10-08T09:30:00.000Z",
    })).toMatch(/overlaps/i);
    expect(weekEvents(event.memory, new Date("2026-10-05T00:00:00.000Z"))).toHaveLength(1);
  });
});
