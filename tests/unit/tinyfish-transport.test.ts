import { describe, expect, it, vi } from "vitest";
import {
  createValidatedTinyFishTransport,
  runEvidencePipeline,
} from "../../packages/tinyfish/src/index.js";

const hash = "e".repeat(64);

describe("TinyFish transport boundary", () => {
  it("uses Search and Fetch without invoking Agent by default", async () => {
    const agent = vi.fn();
    const transport = createValidatedTinyFishTransport({
      search: vi.fn().mockResolvedValue({
        results: [
          {
            title: "University notes",
            url: "https://example.edu/notes",
            snippet: "A concise extract",
            rank: 1,
          },
        ],
      }),
      fetch: vi.fn().mockResolvedValue({
        results: [
          {
            url: "https://example.edu/notes",
            title: "University notes",
            text: "Verified public text",
            contentHash: hash,
            checkedAt: "2026-10-01T12:00:00.000Z",
            status: "ok",
          },
        ],
      }),
      agent,
    });

    const result = await runEvidencePipeline(transport, {
      query: "conditional probability",
      purpose: "Find a reliable course explanation",
      location: "AE",
      language: "en",
    });

    expect(result.endpointsUsed).toEqual(["search", "fetch"]);
    expect(agent).not.toHaveBeenCalled();
  });

  it("forces every Agent request into read-only mode", async () => {
    const agent = vi.fn().mockResolvedValue({
      url: "https://catalog.example.edu",
      summary: "The public catalog lists one available edition.",
      extractedText: "Edition 4, available",
      contentHash: hash,
      checkedAt: "2026-10-01T12:00:00.000Z",
      stepsUsed: 3,
    });
    const transport = createValidatedTinyFishTransport({
      search: vi.fn().mockResolvedValue({ results: [] }),
      fetch: vi.fn(),
      agent,
    });

    const result = await runEvidencePipeline(transport, {
      query: "current textbook edition",
      purpose: "Inspect a public interactive catalog",
      interactiveSource: {
        url: "https://catalog.example.edu",
        readOnlyGoal: "Read the edition and availability without submitting anything.",
      },
    });

    expect(result.endpointsUsed).toEqual(["search", "agent"]);
    expect(agent).toHaveBeenCalledWith(expect.objectContaining({ mode: "read_only" }));
  });

  it("does not spend Agent steps when Fetch already returned readable evidence", async () => {
    const agent = vi.fn();
    const transport = createValidatedTinyFishTransport({
      search: vi.fn().mockResolvedValue({
        results: [
          {
            title: "Catalog page",
            url: "https://catalog.example.edu/course",
            snippet: "Course information",
            rank: 1,
          },
        ],
      }),
      fetch: vi.fn().mockResolvedValue({
        results: [
          {
            url: "https://catalog.example.edu/course",
            title: "Catalog page",
            text: "The prerequisite is STAT 210.",
            contentHash: hash,
            checkedAt: "2026-10-01T12:00:00.000Z",
            status: "ok",
          },
        ],
      }),
      agent,
    });

    const result = await runEvidencePipeline(transport, {
      query: "course prerequisite",
      purpose: "Verify the current prerequisite",
      interactiveSource: {
        url: "https://catalog.example.edu/course",
        readOnlyGoal: "Read the public prerequisite field.",
      },
    });

    expect(result.endpointsUsed).toEqual(["search", "fetch"]);
    expect(agent).not.toHaveBeenCalled();
  });
});
