import { LODGE_TRACE_STEPS_CAP, type LastTraceMemory, type LodgeTraceStep } from "./types.js";

export function recordTraceStep(steps: LodgeTraceStep[], step: LodgeTraceStep): LodgeTraceStep[] {
  return [...steps, step].slice(-LODGE_TRACE_STEPS_CAP);
}

export function buildLastTrace(input: {
  at: string;
  steps: LodgeTraceStep[];
  checkedLive?: boolean;
}): LastTraceMemory {
  const steps = input.steps.slice(-LODGE_TRACE_STEPS_CAP);
  return {
    at: input.at,
    steps,
    checkedLive: input.checkedLive ?? steps.some((step) =>
      step.outcome === "ok" && (step.tool === "search" || step.tool === "fetch" || step.tool === "agent")
    ),
  };
}

export function emptyTrace(at: string): LastTraceMemory {
  return { at, steps: [], checkedLive: false };
}

/** Exact-turn asks for the ledger, not a longer question that mentions the phrase. */
export function isShowTraceRequest(text: string): boolean {
  return /^(?:show[_\s-]?trace|how did you get that)\??$/i.test(text.trim());
}

export function formatShowTrace(trace: LastTraceMemory): string {
  return formatHowDidYouGetThat(trace);
}

export function formatHowDidYouGetThat(trace: LastTraceMemory): string {
  if (trace.steps.length === 0) {
    return "I have not checked a live page this turn.";
  }
  const header = trace.checkedLive ? "How I got that (checked live):" : "How I got that:";
  return [header, ...trace.steps.map((step, index) => formatStep(index + 1, step))].join("\n");
}

function formatStep(index: number, step: LodgeTraceStep): string {
  const duration = formatDuration(step.durationMs);
  const outcome = step.outcome === "ok" ? "ok" : `named failure: ${step.failure ?? "unknown"}`;
  return [
    `${index}.`,
    step.label,
    "·",
    step.tool,
    step.url,
    duration,
    "·",
    outcome,
  ].filter((part) => part !== undefined && part !== "").join(" ");
}

function formatDuration(ms?: number): string {
  if (ms === undefined || !Number.isFinite(ms)) return "";
  if (ms >= 1_000) {
    const seconds = ms / 1_000;
    return `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
  }
  return `${Math.round(ms)}ms`;
}
