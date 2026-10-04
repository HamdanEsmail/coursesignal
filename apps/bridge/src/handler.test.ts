import { describe, expect, it, vi } from "vitest";
import { CourseSignalBridge } from "./handler.js";
import { InMemoryBridgeStore } from "./store.js";
import type {
  ConversationPort,
  InboundContent,
  InboundEnvelope,
  ResearchResult,
  ResearchService,
} from "./types.js";

const NOW = new Date("2026-10-01T18:00:00.000Z");

function successfulResult(query = "question"): ResearchResult {
  return {
    body: `verified result for ${query}`,
    endpoints: ["search", "fetch"],
    sourceUrls: ["https://example.edu/source"],
    sources: [{
      title: "Official source",
      url: "https://example.edu/source",
      excerpt: "This official source contains enough evidence for the requested course question.",
      endpoint: "fetch",
    }],
    checkedAt: NOW.toISOString(),
  };
}

function harness(options: { research?: ResearchService; debounceMs?: number } = {}) {
  const sent: string[] = [];
  const typing: string[] = [];
  const store = new InMemoryBridgeStore();
  const research = options.research ?? {
    research: vi.fn(async ({ query }) => successfulResult(query)),
  };
  const bridge = new CourseSignalBridge({
    store,
    research,
    debounceMs: options.debounceMs ?? 0,
    now: () => NOW,
  });
  const port: ConversationPort = {
    send: async (body) => void sent.push(body),
    startTyping: async () => void typing.push("start"),
    stopTyping: async () => void typing.push("stop"),
  };
  return { bridge, store, research, sent, typing, port };
}

function inbound(
  textOrContent: string | InboundContent,
  eventKey: string,
  conversationKey = "conversation",
): InboundEnvelope {
  return {
    eventKey,
    conversationKey,
    receivedAt: NOW.toISOString(),
    content: typeof textOrContent === "string" ? { type: "text", text: textOrContent } : textOrContent,
  };
}

async function start(h: ReturnType<typeof harness>, conversationKey = "conversation"): Promise<void> {
  await h.bridge.handle(inbound("START", `start-${conversationKey}`, conversationKey), h.port);
  h.sent.splice(0);
}

describe("CourseSignalBridge consent and diagnostics", () => {
  it("requires START before any public-web research", async () => {
    const h = harness();
    await h.bridge.handle(inbound("Explain Bayes theorem", "event-1"), h.port);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatch(/reply START/i);
    expect(h.sent[0]).toMatch(/TinyFish/i);
    expect(h.sent[0]).toMatch(/OpenRouter/i);
    expect(h.sent[0]).toMatch(/does not receive your phone number or saved course name/i);
    expect(h.sent[0]).toMatch(/not your earlier messages/i);
    expect(h.research.research).not.toHaveBeenCalled();
  });

  it("handles echo locally before consent with exactly one reply", async () => {
    const h = harness();
    await h.bridge.handle(inbound("echo iPhone proof", "event-echo"), h.port);
    expect(h.sent).toEqual(["echo: iPhone proof"]);
    expect(h.research.research).not.toHaveBeenCalled();
  });

  it.each(["ping", "status", "test", "health"])(
    "keeps the %s diagnostic away from TinyFish",
    async (command) => {
      const h = harness();
      await h.bridge.handle(inbound(command, `event-${command}`), h.port);
      expect(h.sent).toHaveLength(1);
      expect(h.research.research).not.toHaveBeenCalled();
    },
  );

  it("stores consent only after START", async () => {
    const h = harness();
    await h.bridge.handle(inbound("START", "event-start"), h.port);
    expect((await h.store.getConversation("conversation"))?.consentedAt).toBe(NOW.toISOString());
    expect((await h.store.getConversation("conversation"))?.consentVersion).toBe(3);
    expect(h.sent[0]).toMatch(/ready/i);
  });

  it("requires renewed consent for a legacy TinyFish-only conversation", async () => {
    const h = harness();
    await h.store.putConversation("conversation", {
      consentedAt: NOW.toISOString(),
      courses: ["STAT 210"],
      activeCourse: "STAT 210",
      watches: [],
      updatedAt: NOW.toISOString(),
    });

    await h.bridge.handle(inbound("Explain Bayes theorem", "legacy-question"), h.port);
    expect(h.sent.at(-1)).toMatch(/reply START/i);
    expect(h.research.research).not.toHaveBeenCalled();

    await h.bridge.handle(inbound("START", "legacy-start"), h.port);
    const renewed = await h.store.getConversation("conversation");
    expect(renewed?.consentVersion).toBe(3);
    expect(renewed?.activeCourse).toBe("STAT 210");
  });

  it("suppresses an inbound retry with the same opaque event key", async () => {
    const h = harness();
    await h.bridge.handle(inbound("echo once", "same-event"), h.port);
    await h.bridge.handle(inbound("echo once", "same-event"), h.port);
    expect(h.sent).toEqual(["echo: once"]);
  });
});

describe("CourseSignalBridge research", () => {
  it("acknowledges before research, uses typing, and saves the receipt", async () => {
    let release: (() => void) | undefined;
    const research: ResearchService = {
      research: vi.fn(async ({ query }) => {
        await new Promise<void>((resolve) => { release = resolve; });
        return successfulResult(query);
      }),
    };
    const h = harness({ research });
    await start(h);
    const work = h.bridge.handle(inbound("Explain independence", "event-question"), h.port);
    await vi.waitFor(() => expect(h.sent).toHaveLength(1));
    expect(h.sent[0]).toMatch(/Checking public sources for that now/);
    expect(h.typing).toEqual(["start"]);
    release?.();
    await work;
    expect(h.sent[1]).toBe("verified result for Explain independence");
    expect(h.typing).toEqual(["start", "stop"]);
    expect((await h.store.getConversation("conversation"))?.lastResearch?.sources).toHaveLength(1);
  });

  it("debounces ordinary message fragments into one research request", async () => {
    const h = harness({ debounceMs: 5 });
    await start(h);
    const first = h.bridge.handle(inbound("Explain conditional", "event-a"), h.port);
    const second = h.bridge.handle(inbound("probability", "event-b"), h.port);
    await Promise.all([first, second]);
    expect(h.research.research).toHaveBeenCalledOnce();
    expect(h.research.research).toHaveBeenCalledWith(expect.objectContaining({
      query: "Explain conditional probability",
    }));
  });

  it("returns a cautious message after provider failure and does not retry Agent", async () => {
    const h = harness({ research: { research: vi.fn(async () => { throw new Error("provider failed"); }) } });
    await start(h);
    await h.bridge.handle(inbound("Question", "event-fail"), h.port);
    expect(h.sent.at(-1)).toMatch(/have not guessed|not guessed/i);
    expect(h.research.research).toHaveBeenCalledOnce();
  });

  it("does not upload or research a non-text attachment", async () => {
    const h = harness();
    await start(h);
    await h.bridge.handle(inbound({ type: "unsupported", kind: "attachment" }, "event-file"), h.port);
    expect(h.sent.at(-1)).toMatch(/won’t upload or analyze/i);
    expect(h.research.research).not.toHaveBeenCalled();
  });
});

describe("CourseSignalBridge memory commands", () => {
  it("adds, lists, switches, and removes explicit course memory", async () => {
    const h = harness();
    await start(h);
    await h.bridge.handle(inbound("COURSE STAT 210", "course-1"), h.port);
    await h.bridge.handle(inbound("COURSE BANA 200", "course-2"), h.port);
    await h.bridge.handle(inbound("COURSE USE STAT 210", "course-3"), h.port);
    await h.bridge.handle(inbound("COURSE LIST", "course-4"), h.port);
    expect(h.sent.at(-1)).toContain("● STAT 210");
    await h.bridge.handle(inbound("COURSE REMOVE STAT 210", "course-5"), h.port);
    expect((await h.store.getConversation("conversation"))?.activeCourse).toBe("BANA 200");
  });

  it("routes PLAN through the latest question and active course", async () => {
    const h = harness();
    await start(h);
    await h.bridge.handle(inbound("COURSE STAT 210", "plan-course"), h.port);
    await h.bridge.handle(inbound("Explain conditional probability", "plan-question"), h.port);
    await h.bridge.handle(inbound("PLAN", "plan-command"), h.port);
    expect(h.research.research).toHaveBeenLastCalledWith({
      query: "conditional probability",
      mode: "plan",
      course: "STAT 210",
    });
  });

  it("keeps a short example follow-up on the last topic", async () => {
    const h = harness();
    await start(h);
    await h.bridge.handle(inbound("What is Conditional probability in statistics?", "follow-1"), h.port);
    await h.bridge.handle(inbound("Give me an explainable example?", "follow-2"), h.port);
    expect(h.research.research).toHaveBeenLastCalledWith(expect.objectContaining({
      query: "Conditional probability in statistics — Give me an explainable example?",
      mode: "answer",
    }));
    expect((await h.store.getConversation("conversation"))?.lastResearch?.topic)
      .toBe("Conditional probability in statistics");
  });

  it("replaces the topic when the next message is a new question", async () => {
    const h = harness();
    await start(h);
    await h.bridge.handle(inbound("What is Conditional probability in statistics?", "switch-1"), h.port);
    await h.bridge.handle(inbound("What is Bayes theorem?", "switch-2"), h.port);
    const query = vi.mocked(h.research.research).mock.calls.at(-1)?.[0].query;
    expect(query).toBe("What is Bayes theorem?");
    expect(query).not.toMatch(/conditional probability/i);
    expect((await h.store.getConversation("conversation"))?.lastResearch?.topic).toBe("Bayes theorem");
  });

  it("requires START again after the older follow-up disclosure", async () => {
    const h = harness();
    await h.store.putConversation("conversation", {
      consentedAt: NOW.toISOString(),
      consentVersion: 2,
      courses: ["STAT 210"],
      activeCourse: "STAT 210",
      watches: [],
      updatedAt: NOW.toISOString(),
    });
    await h.bridge.handle(inbound("Give me an example", "consent-v2"), h.port);
    expect(h.research.research).not.toHaveBeenCalled();
    expect(h.sent.at(-1)).toMatch(/reply START/i);
  });

  it("returns SOURCES from memory without another provider call", async () => {
    const h = harness();
    await start(h);
    await h.bridge.handle(inbound("Research this", "source-question"), h.port);
    const calls = vi.mocked(h.research.research).mock.calls.length;
    await h.bridge.handle(inbound("SOURCES", "source-command"), h.port);
    expect(h.sent.at(-1)).toContain("EVIDENCE RECEIPT");
    expect(h.sent.at(-1)).toContain("This official source contains enough evidence");
    expect(h.sent.at(-1)).toContain("https://example.edu/source");
    expect(h.research.research).toHaveBeenCalledTimes(calls);
  });

  it("prints a readable SOURCES receipt without markdown or latex", async () => {
    const h = harness();
    await start(h);
    await h.store.putConversation("conversation", {
      consentedAt: NOW.toISOString(),
      consentVersion: 3,
      courses: [],
      watches: [],
      updatedAt: NOW.toISOString(),
      lastResearch: {
        query: "conditional probability",
        topic: "conditional probability",
        mode: "answer",
        checkedAt: NOW.toISOString(),
        endpoints: ["search", "fetch"],
        sources: [{
          title: "Untitled source",
          url: "https://www.probabilitycourse.com/chapter1/1_4_0_conditional_probability.php",
          excerpt: "## 1.4.0 Conditional Probability $P(R)=0.23$ \\textrm{where} R is rain.",
          endpoint: "fetch",
        }],
      },
    });
    await h.bridge.handle(inbound("SOURCES", "source-latex"), h.port);
    const receipt = h.sent.at(-1) ?? "";
    expect(receipt).toContain("EVIDENCE RECEIPT");
    expect(receipt).toContain("P(R)=0.23");
    expect(receipt).not.toContain("##");
    expect(receipt).not.toContain("textrm");
    expect(receipt).not.toContain("Untitled source");
    expect(receipt).toContain("https://www.probabilitycourse.com/chapter1/1_4_0_conditional_probability.php");
  });

  it("opts into WATCH and pauses it with STOP", async () => {
    const h = harness();
    await start(h);
    await h.bridge.handle(inbound("WATCH https://example.edu/syllabus", "watch-1"), h.port);
    expect((await h.store.getConversation("conversation"))?.watches[0]?.active).toBe(true);
    await h.bridge.handle(inbound("STOP", "watch-2"), h.port);
    expect((await h.store.getConversation("conversation"))?.watches[0]?.active).toBe(false);
  });

  it("requires a fresh explicit confirmation before full deletion", async () => {
    const h = harness();
    await start(h);
    await h.bridge.handle(inbound("COURSE STAT 210", "forget-course"), h.port);
    await h.bridge.handle(inbound("FORGET", "forget-request"), h.port);
    expect(await h.store.getConversation("conversation")).toBeDefined();
    await h.bridge.handle(inbound("FORGET CONFIRM", "forget-confirm"), h.port);
    expect(await h.store.getConversation("conversation")).toBeUndefined();
    expect(h.sent.at(-1)).toMatch(/deleted/i);
  });
});
