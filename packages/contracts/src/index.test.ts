import { describe, expect, it } from "vitest";
import {
  inboundEnvelopeSchema,
  signalSchema,
  tinyfishAgentRequestSchema,
} from "./index.js";

describe("signalSchema", () => {
  it("rejects an evidence source without an absolute web URL", () => {
    const result = signalSchema.safeParse({
      id: "signal-1",
      course: "STAT 210",
      title: "Tonight's signal",
      question: "What should I focus on?",
      answer: "Review Unit 3.",
      actions: [],
      claims: [],
      sources: [
        {
          id: "source-1",
          title: "Syllabus",
          publisher: "Demo University",
          url: "not-a-url",
          checkedAt: "2026-10-01T18:00:00.000Z",
          endpoint: "fetch",
        },
      ],
      stages: [],
      createdAt: "2026-10-01T18:00:00.000Z",
      checkedAt: "2026-10-01T18:00:00.000Z",
      watchState: "off",
    });

    expect(result.success).toBe(false);
  });
});

describe("provider boundary contracts", () => {
  it("requires a canonical payload digest on inbound envelopes", () => {
    const result = inboundEnvelopeSchema.safeParse({
      eventId: "evt-1",
      senderKey: "opaque-sender-key",
      conversationKey: "opaque-conversation-key",
      text: "Research conditional probability",
      receivedAt: "2026-10-01T18:00:00.000Z",
      provider: "photon",
      payloadHash: "NOT-A-DIGEST",
    });

    expect(result.success).toBe(false);
  });

  it("does not admit a mutating TinyFish Agent mode", () => {
    const result = tinyfishAgentRequestSchema.safeParse({
      url: "https://catalog.example.edu",
      goal: "Submit this form",
      purpose: "Course research",
      mode: "write",
    });

    expect(result.success).toBe(false);
  });
});
