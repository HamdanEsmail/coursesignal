import { describe, expect, it } from "vitest";
import {
  beatAt,
  beatJumpProgress,
  beatProgress,
  buildTimeline,
  dayBeats,
  marketingCorpus,
  phoneFace,
  visibleLineIds,
} from "./day.js";

const FORBIDDEN =
  /HMAC|Cloudflare|OpenRouter|TinyFish|Photon|CourseSignal|STAT 210|\bICS\b|_worker|Pages Function/i;

describe("A day with Lodge", () => {
  it("teaches the texts a student actually sends", () => {
    expect(dayBeats.map((beat) => beat.say)).toEqual([
      "Lodge texts first",
      "what's due this week?",
      "save the week",
      "any internships in Dubai?",
      "note that office hours moved",
      "thumbs-up when it’s done",
      "quiet hours",
    ]);
    expect(marketingCorpus()).not.toMatch(FORBIDDEN);
    for (const beat of dayBeats) {
      expect(beat.happen.length).toBeGreaterThan(20);
      expect(`${beat.title} ${beat.happen} ${beat.say}`).not.toMatch(FORBIDDEN);
    }
  });

  it("has a slip you can open, a Save you approve, a role, and a heart", () => {
    const kinds = dayBeats.flatMap((beat) => beat.lines.map((line) => line.kind));
    expect(kinds).toContain("slip");
    expect(kinds).toContain("save");
    expect(kinds).toContain("role");
    expect(kinds).toContain("you");
    const taps = dayBeats.flatMap((beat) => beat.lines).filter((line) => line.kind === "tapback");
    expect(taps.some((line) => line.kind === "tapback" && line.tap === "heart")).toBe(true);
    expect(taps.some((line) => line.kind === "tapback" && line.tap === "up")).toBe(true);
  });

  it("reveals the thread in order and starts on the lock screen", () => {
    const timeline = buildTimeline();
    expect(visibleLineIds(0, timeline).size).toBe(0);
    expect(visibleLineIds(1, timeline).has("m-done")).toBe(true);
    expect(beatAt(0).face).toBe("lock");
    expect(beatAt(0).id).toBe("remind");
    expect(beatAt(1).id).toBe("quiet");
    expect(beatProgress(0)).toBe(0);
    expect(beatProgress(dayBeats.length - 1)).toBe(1);
    expect(dayBeats.some((beat) => beat.lines.some((line) => line.kind === "notif"))).toBe(true);
    expect(phoneFace(0)).toBe("lock");
    expect(phoneFace(0.2)).toBe("messages");
    expect(phoneFace(1)).toBe("sleep");
    expect(visibleLineIds(beatJumpProgress(1), timeline).has("m-slip")).toBe(true);
    expect(visibleLineIds(beatJumpProgress(2), timeline).has("m-save")).toBe(true);
    expect(beatAt(beatJumpProgress(2)).id).toBe("save");
    expect(dayBeats.every((beat) => beat.rail.length > 0 && beat.cue.length > 12)).toBe(true);
  });
});
