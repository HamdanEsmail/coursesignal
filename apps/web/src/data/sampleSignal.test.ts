import { describe, expect, it } from "vitest";
import { sampleSignal } from "./sampleSignal.js";

describe("sampleSignal", () => {
  it("labels fixture evidence without pretending Agent was used", () => {
    expect(sampleSignal.sources.some((source) => source.publisher.includes("Synthetic"))).toBe(
      true,
    );
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
});
