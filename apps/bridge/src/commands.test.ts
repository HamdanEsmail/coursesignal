import { describe, expect, it } from "vitest";
import { parseCommand } from "./commands.js";

describe("parseCommand", () => {
  it.each([
    ["echo iPhone proof", { kind: "echo", text: "iPhone proof" }],
    ["ping", { kind: "diagnostic", action: "ping" }],
    ["START", { kind: "start" }],
    ["sources", { kind: "sources" }],
    ["PLAN prepare for quiz", { kind: "plan", prompt: "prepare for quiz" }],
    ["WATCH https://example.edu", { kind: "watch", target: "https://example.edu" }],
    ["STOP", { kind: "stop" }],
    ["FORGET CONFIRM", { kind: "forget", action: "confirm" }],
    ["COURSE STAT 210", { kind: "course", action: "add", name: "STAT 210" }],
    ["COURSE USE BANA 200", { kind: "course", action: "use", name: "BANA 200" }],
    ["COURSES", { kind: "course", action: "list", name: "" }],
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
