import { describe, expect, it } from "vitest";
import { demoThread, sampleSignal } from "./sampleSignal.js";

describe("sampleSignal", () => {
  it("showcases a public-source iMessage answer without claiming Agent ran", () => {
    expect(sampleSignal.question).toMatch(/conditional probability/i);
    expect(sampleSignal.answer).toMatch(/P\(R\)=0\.23/);
    expect(sampleSignal.sources.map((source) => source.publisher).join(" ")).toMatch(/OpenStax/);
    expect(sampleSignal.sources.every((source) => !/study\.com/i.test(source.url))).toBe(true);
    expect(sampleSignal.stages.find((stage) => stage.endpoint === "agent")?.status).toBe(
      "waiting",
    );
  });

  it("keeps every referenced source resolvable", () => {
    const sourceIds = new Set(sampleSignal.sources.map((source) => source.id));
    const missing = sampleSignal.claims.flatMap((claim) =>
      claim.sourceIds.filter((sourceId) => !sourceIds.has(sourceId)),
    );
    expect(missing).toEqual([]);
  });

  it("keeps the demo thread on the same topic", () => {
    expect(demoThread.some((bubble) => bubble.role === "student" && /example/i.test(bubble.text))).toBe(true);
    expect(demoThread.filter((bubble) => bubble.role === "signal").every((bubble) =>
      /conditional|P\(|rain/i.test(bubble.text),
    )).toBe(true);
  });
});
