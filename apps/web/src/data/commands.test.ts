import { describe, expect, it } from "vitest";
import { commandRows, everydayAskHint, starterCommands } from "./commands.js";

describe("command crib", () => {
  it("lists the Lodge friend-loop texts", () => {
    expect(commandRows.map((row) => row.command)).toEqual([
      "START",
      "skip",
      "HELP",
      "what's due",
      "what's on",
      "remind me",
      "snooze 1h",
      "note that",
      "any internships",
      "I applied",
      "how did you get that?",
      "FORGET",
      "FORGET CONFIRM",
    ]);
  });

  it("gives each row a when-to-send note and one example line", () => {
    for (const row of commandRows) {
      expect(row.when.length).toBeGreaterThan(20);
      expect(row.example.toLowerCase().startsWith(row.command.split(" ")[0]?.toLowerCase() ?? "")).toBe(
        true,
      );
    }
  });

  it("puts START on the Arrive strip and drops the old crib", () => {
    expect(starterCommands[0]).toBe("START");
    expect(starterCommands).toContain("what's due");
    const corpus = `${JSON.stringify(commandRows)}${everydayAskHint}${starterCommands.join(" ")}`;
    expect(corpus).not.toMatch(/CourseSignal|STAT 210|\bSOURCES\b|\bWATCH\b|COURSE LIST|COURSE USE|copilot|tutor/i);
  });
});
