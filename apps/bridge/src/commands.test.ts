import { describe, expect, it } from "vitest";
import { parseCommand } from "./commands.js";

describe("parseCommand", () => {
  it.each([
    ["echo iPhone proof", { kind: "echo", text: "iPhone proof" }],
    ["ping", { kind: "diagnostic", action: "ping" }],
    ["START", { kind: "start" }],
    ["skip", { kind: "skip" }],
    ["sources", { kind: "sources" }],
    ["how did you get that?", { kind: "show_trace" }],
    ["PLAN prepare for quiz", { kind: "plan", prompt: "prepare for quiz" }],
    ["WATCH https://example.edu", { kind: "watch", target: "https://example.edu" }],
    ["STOP", { kind: "stop" }],
    ["FORGET CONFIRM", { kind: "forget", action: "confirm" }],
    ["forget note office hours", { kind: "forget_note", text: "office hours" }],
    ["COURSE STAT 210", { kind: "course", action: "add", name: "STAT 210" }],
    ["COURSE USE BANA 200", { kind: "course", action: "use", name: "BANA 200" }],
    ["COURSES", { kind: "course", action: "list", name: "" }],
    ["what's due", { kind: "whats_due" }],
    ["whats on", { kind: "whats_on" }],
    ["note that office hours moved", { kind: "note", text: "office hours moved" }],
    ["show notes", { kind: "show_notes" }],
    ["remind me in 5 minutes", { kind: "remind", text: "Reminder", when: "in 5 minutes" }],
    ["snooze 1h", { kind: "snooze", duration: "1h" }],
    ["I applied", { kind: "applied" }],
    ["save this", { kind: "save" }],
    ["YES", { kind: "confirm" }],
    ["any internships in Dubai?", { kind: "find_roles", query: "internship", city: "Dubai" }],
  ])("parses %s", (input, expected) => {
    expect(parseCommand(input)).toEqual(expected);
  });

  it("treats ordinary text as research", () => {
    expect(parseCommand("What is conditional probability?")).toEqual({
      kind: "research",
      prompt: "What is conditional probability?",
    });
  });
});
