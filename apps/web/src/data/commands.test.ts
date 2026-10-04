import { describe, expect, it } from "vitest";
import { commandRows, starterCommands } from "./commands.js";

describe("command crib", () => {
  it("quotes the live student commands", () => {
    const listed = commandRows.map((row) => row.command);
    expect(listed).toEqual([
      "START",
      "HELP",
      "COURSE",
      "COURSE LIST",
      "COURSE USE",
      "COURSE REMOVE",
      "SOURCES",
      "PLAN",
      "WATCH",
      "STOP",
      "MEMORY",
      "EXAMPLE",
      "FORGET",
      "FORGET CONFIRM",
    ]);
  });

  it("gives each row a when-to-send note and one example line", () => {
    for (const row of commandRows) {
      expect(row.when.length).toBeGreaterThan(20);
      expect(row.example.startsWith(row.command.split(" ")[0] ?? "")).toBe(true);
    }
  });

  it("puts START on the home strip", () => {
    expect(starterCommands[0]).toBe("START");
    expect(starterCommands).toContain("SOURCES");
  });
});
