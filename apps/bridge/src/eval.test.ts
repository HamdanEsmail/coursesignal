import { afterEach, describe, expect, it, vi } from "vitest";
import { LODGE_MODE_DEFAULT, isLodgeModeEnabled } from "./agent.js";
import {
  LODGE_TOOL_GATE_CASES,
  chooseLodgeTool,
  runLodgeEval,
} from "./eval.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Lodge offline eval harness", () => {
  it("keeps LODGE_MODE off unless the env token is explicit", () => {
    expect(LODGE_MODE_DEFAULT).toBe(false);
    expect(isLodgeModeEnabled()).toBe(false);
    vi.stubEnv("LODGE_MODE", "true");
    expect(isLodgeModeEnabled()).toBe(true);
  });

  it("freezes at least 30 local Gemma tool-call prompts", () => {
    expect(LODGE_TOOL_GATE_CASES.length).toBeGreaterThanOrEqual(30);
    const ids = new Set(LODGE_TOOL_GATE_CASES.map((item) => item.id));
    expect(ids.size).toBe(LODGE_TOOL_GATE_CASES.length);
    for (const item of LODGE_TOOL_GATE_CASES) {
      expect(chooseLodgeTool(item.prompt)).toBe(item.expectedTool);
    }
  });

  it("passes the mocked TinyFish/Gemma gate without spending credits", async () => {
    const report = await runLodgeEval();
    expect(report.spentCredits).toBe(false);
    expect(report.gate.total).toBeGreaterThanOrEqual(30);
    expect(report.gate.failures).toEqual([]);
    expect(report.checks.filter((check) => !check.ok)).toEqual([]);
    expect(report.passed).toBe(true);
  });
});
