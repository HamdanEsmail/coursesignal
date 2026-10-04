import { describe, expect, it } from "vitest";
import { LODGE_TRACE_STEPS_CAP, type LodgeTraceStep } from "./types.js";
import {
  buildLastTrace,
  emptyTrace,
  formatHowDidYouGetThat,
  formatShowTrace,
  isShowTraceRequest,
  recordTraceStep,
} from "./trace.js";

const fetchOk: LodgeTraceStep = {
  tool: "fetch",
  label: "T1",
  url: "https://econ.example.edu/syllabus",
  durationMs: 1_100,
  outcome: "ok",
};

const agentFail: LodgeTraceStep = {
  tool: "agent",
  label: "T2 · still_open",
  url: "https://careers.example.edu/intern",
  durationMs: 800,
  outcome: "named_failure",
  failure: "page blocked",
};

describe("isShowTraceRequest", () => {
  it("matches the ledger asks and ignores longer questions", () => {
    expect(isShowTraceRequest("how did you get that")).toBe(true);
    expect(isShowTraceRequest("How did you get that?")).toBe(true);
    expect(isShowTraceRequest("show_trace")).toBe(true);
    expect(isShowTraceRequest("show trace")).toBe(true);
    expect(isShowTraceRequest("how did you get that, and what's due")).toBe(false);
  });
});

describe("last-turn trace", () => {
  it("caps recorded steps and marks live checks", () => {
    let steps: LodgeTraceStep[] = [];
    for (let index = 0; index < LODGE_TRACE_STEPS_CAP + 3; index += 1) {
      steps = recordTraceStep(steps, { ...fetchOk, label: `T${index + 1}` });
    }
    expect(steps).toHaveLength(LODGE_TRACE_STEPS_CAP);
    expect(steps[0]?.label).toBe("T4");
    const trace = buildLastTrace({ at: "2026-10-04T08:00:00.000Z", steps });
    expect(trace.checkedLive).toBe(true);
    expect(emptyTrace("2026-10-04T08:00:00.000Z")).toEqual({
      at: "2026-10-04T08:00:00.000Z",
      steps: [],
      checkedLive: false,
    });
  });

  it("formats show_trace / how did you get that with named failures", () => {
    const trace = buildLastTrace({
      at: "2026-10-04T08:00:00.000Z",
      steps: [fetchOk, agentFail],
      checkedLive: true,
    });
    const shown = formatShowTrace(trace);
    expect(shown).toBe(formatHowDidYouGetThat(trace));
    expect(shown).toContain("How I got that (checked live):");
    expect(shown).toContain("T1 · fetch https://econ.example.edu/syllabus 1.1s · ok");
    expect(shown).toContain("named failure: page blocked");
    expect(formatHowDidYouGetThat(emptyTrace("2026-10-04T08:00:00.000Z"))).toBe(
      "I have not checked a live page this turn.",
    );
  });
});
