import { describe, expect, it, vi } from "vitest";
import { LodgeAgent } from "./agent.js";
import { CourseSignalBridge } from "./handler.js";
import { InMemoryBridgeStore } from "./store.js";
import { FIRSTROLE_URL } from "./tools.js";
import type {
  ConversationPort,
  InboundContent,
  InboundEnvelope,
  ResearchResult,
  ResearchService,
} from "./types.js";
import type { LodgeModelClient, LodgeToolCall, OpenRouterToolCompletion } from "./openrouter.js";

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

function harness(options: {
  research?: ResearchService;
  debounceMs?: number;
  tinyfish?: ConstructorParameters<typeof CourseSignalBridge>[0]["tinyfish"];
  createAgent?: ConstructorParameters<typeof CourseSignalBridge>[0]["createAgent"];
  vision?: ConstructorParameters<typeof CourseSignalBridge>[0]["vision"];
  roles?: ConstructorParameters<typeof CourseSignalBridge>[0]["roles"];
} = {}) {
  const sent: string[] = [];
  const typing: string[] = [];
  const apps: Array<{ url: string; title?: string }> = [];
  const store = new InMemoryBridgeStore();
  const research = options.research ?? {
    research: vi.fn(async ({ query }) => successfulResult(query)),
  };
  const bridge = new CourseSignalBridge({
    store,
    research,
    debounceMs: options.debounceMs ?? 0,
    now: () => NOW,
    tinyfish: options.tinyfish,
    createAgent: options.createAgent,
    vision: options.vision,
    roles: options.roles,
  });
  const port: ConversationPort = {
    send: async (body) => void sent.push(body),
    startTyping: async () => void typing.push("start"),
    stopTyping: async () => void typing.push("stop"),
    sendApp: async (card) => {
      apps.push(card);
      return { messageId: `app-${apps.length}` };
    },
    edit: async () => undefined,
  };
  return { bridge, store, research, sent, typing, apps, port };
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
  for (const step of ["skip-school", "skip-course", "skip-events", "skip-roles"]) {
    await h.bridge.handle(inbound("skip", `${step}-${conversationKey}`, conversationKey), h.port);
  }
  h.sent.splice(0);
  h.apps.splice(0);
}

function assertLodgeVoice(sent: string[]): void {
  const blob = sent.join("\n");
  expect(blob).not.toMatch(/CourseSignal/i);
  expect(blob).not.toMatch(/STAT 210/i);
}

describe("Lodge consent and diagnostics", () => {
  it("requires START before any public-web research", async () => {
    const h = harness();
    await h.bridge.handle(inbound("Explain Bayes theorem", "event-1"), h.port);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatch(/reply START/i);
    expect(h.sent[0]).toMatch(/TinyFish/i);
    expect(h.sent[0]).toMatch(/Lodge/i);
    expect(h.sent[0]).toMatch(/does not receive your phone number/i);
    expect(h.sent[0]).toMatch(/never apply/i);
    expect(h.research.research).not.toHaveBeenCalled();
    assertLodgeVoice(h.sent);
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

  it("stores Lodge consent v4 only after START and begins check-in", async () => {
    const h = harness();
    await h.bridge.handle(inbound("START", "event-start"), h.port);
    expect((await h.store.getConversation("conversation"))?.consentedAt).toBe(NOW.toISOString());
    expect((await h.store.getConversation("conversation"))?.consentVersion).toBe(4);
    expect((await h.store.getConversation("conversation"))?.checkInStep).toBe("school");
    expect(h.sent[0]).toMatch(/ready/i);
    expect(h.sent[0]).toMatch(/school/i);
    assertLodgeVoice(h.sent);
  });

  it("requires renewed consent for a legacy TinyFish-only conversation", async () => {
    const h = harness();
    await h.store.putConversation("conversation", {
      consentedAt: NOW.toISOString(),
      courses: [],
      watches: [],
      updatedAt: NOW.toISOString(),
    });

    await h.bridge.handle(inbound("Explain Bayes theorem", "legacy-question"), h.port);
    expect(h.sent.at(-1)).toMatch(/reply START/i);
    expect(h.research.research).not.toHaveBeenCalled();

    await h.bridge.handle(inbound("START", "legacy-start"), h.port);
    const renewed = await h.store.getConversation("conversation");
    expect(renewed?.consentVersion).toBe(4);
    assertLodgeVoice(h.sent);
  });

  it("suppresses an inbound retry with the same opaque event key", async () => {
    const h = harness();
    await h.bridge.handle(inbound("echo once", "same-event"), h.port);
    await h.bridge.handle(inbound("echo once", "same-event"), h.port);
    expect(h.sent).toEqual(["echo: once"]);
  });
});

describe("Lodge check-in and research", () => {
  it("walks school, pages, and optional roles, and skip works", async () => {
    const h = harness();
    await h.bridge.handle(inbound("START", "ci-start"), h.port);
    await h.bridge.handle(inbound("NYU Abu Dhabi", "ci-school"), h.port);
    expect((await h.store.getConversation("conversation"))?.timezone).toBe("Asia/Dubai");
    await h.bridge.handle(inbound("https://econ.example.edu/syllabus", "ci-course"), h.port);
    await h.bridge.handle(inbound("https://events.example.edu/week", "ci-events"), h.port);
    await h.bridge.handle(inbound("internships in Dubai", "ci-roles"), h.port);
    const saved = await h.store.getConversation("conversation");
    expect(saved?.checkInStep).toBe("done");
    expect(saved?.rolesCity).toBe("Dubai");
    expect(saved?.savedLinks?.some((link) => link.kind === "course")).toBe(true);
    expect(saved?.savedLinks?.some((link) => link.kind === "events")).toBe(true);
    assertLodgeVoice(h.sent);
  });

  it("lets skip finish check-in without pages", async () => {
    const h = harness();
    await h.bridge.handle(inbound("START", "skip-start"), h.port);
    await h.bridge.handle(inbound("skip", "s1"), h.port);
    await h.bridge.handle(inbound("skip", "s2"), h.port);
    await h.bridge.handle(inbound("skip", "s3"), h.port);
    await h.bridge.handle(inbound("skip", "s4"), h.port);
    expect((await h.store.getConversation("conversation"))?.checkInStep).toBe("done");
    expect(h.sent.at(-1)).toMatch(/ready|due|public link/i);
    assertLodgeVoice(h.sent);
  });

  it("acknowledges with a slip, uses typing, and saves the receipt", async () => {
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
    await vi.waitFor(() => expect(h.typing).toContain("start"));
    expect(h.apps[0]?.title).toMatch(/Looking it up/i);
    release?.();
    await work;
    expect(h.sent.some((body) => body.includes("verified result for Explain independence"))).toBe(true);
    expect(h.typing).toEqual(["start", "stop"]);
    expect((await h.store.getConversation("conversation"))?.lastResearch?.sources).toHaveLength(1);
    assertLodgeVoice(h.sent);
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
    assertLodgeVoice(h.sent);
  });

  it("does not upload a non-image attachment", async () => {
    const h = harness();
    await start(h);
    await h.bridge.handle(inbound({ type: "unsupported", kind: "attachment" }, "event-file"), h.port);
    expect(h.sent.at(-1)).toMatch(/tapbacks|photos|text/i);
    expect(h.research.research).not.toHaveBeenCalled();
  });

  it("offers to save a poster photo without reading bytes when vision is unwired", async () => {
    const read = vi.fn(async () => { throw new Error("should not read"); });
    const h = harness();
    await start(h);
    await h.bridge.handle(
      inbound({ type: "unsupported", kind: "image", mimeType: "image/jpeg", read } as InboundContent, "event-photo"),
      h.port,
    );
    expect(read).not.toHaveBeenCalled();
    expect(h.sent.at(-1)).toMatch(/saw a photo/i);
    expect(h.research.research).not.toHaveBeenCalled();
    assertLodgeVoice(h.sent);
  });
});

describe("Lodge memory, tapbacks, and tools", () => {
  it("notes, shows, and forgets without course-code commands", async () => {
    const h = harness();
    await start(h);
    await h.bridge.handle(inbound("note that office hours moved", "note-1"), h.port);
    await h.bridge.handle(inbound("show notes", "note-2"), h.port);
    expect(h.sent.join("\n")).toMatch(/office hours moved/i);
    await h.bridge.handle(inbound("COURSE STAT 210", "course-1"), h.port);
    expect(h.sent.at(-1)).toMatch(/public course pages/i);
    assertLodgeVoice(h.sent);
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
    expect((await h.store.getConversation("conversation"))?.lastResearch?.topic).toBe("Bayes theorem");
  });

  it("requires START again after the older follow-up disclosure", async () => {
    const h = harness();
    await h.store.putConversation("conversation", {
      consentedAt: NOW.toISOString(),
      consentVersion: 2,
      courses: [],
      watches: [],
      updatedAt: NOW.toISOString(),
    });
    await h.bridge.handle(inbound("Give me an example", "consent-v2"), h.port);
    expect(h.research.research).not.toHaveBeenCalled();
    expect(h.sent.at(-1)).toMatch(/reply START/i);
  });

  it("returns the ledger from memory without another provider call", async () => {
    const h = harness();
    await start(h);
    await h.bridge.handle(inbound("Research this", "source-question"), h.port);
    const calls = vi.mocked(h.research.research).mock.calls.length;
    await h.store.putConversation("conversation", {
      ...(await h.store.getConversation("conversation"))!,
      lastTrace: {
        at: NOW.toISOString(),
        checkedLive: true,
        steps: [{ tool: "fetch", label: "T1", url: "https://example.edu/source", outcome: "ok", durationMs: 12 }],
      },
    });
    await h.bridge.handle(inbound("how did you get that?", "source-command"), h.port);
    expect(h.sent.at(-1)).toContain("How I got that (checked live):");
    expect(h.sent.at(-1)).toContain("https://example.edu/source");
    expect(h.research.research).toHaveBeenCalledTimes(calls);
    assertLodgeVoice(h.sent);
  });

  it("opts into WATCH and pauses it with STOP", async () => {
    const h = harness();
    await start(h);
    await h.bridge.handle(inbound("WATCH https://example.edu/syllabus", "watch-1"), h.port);
    expect((await h.store.getConversation("conversation"))?.watches[0]?.active).toBe(true);
    await h.bridge.handle(inbound("STOP", "watch-2"), h.port);
    expect((await h.store.getConversation("conversation"))?.watches[0]?.active).toBe(false);
    assertLodgeVoice(h.sent);
  });

  it("requires a fresh explicit confirmation before full deletion", async () => {
    const h = harness();
    await start(h);
    await h.bridge.handle(inbound("note that keep this", "forget-note"), h.port);
    await h.bridge.handle(inbound("FORGET", "forget-request"), h.port);
    expect(await h.store.getConversation("conversation")).toBeDefined();
    await h.bridge.handle(inbound("FORGET CONFIRM", "forget-confirm"), h.port);
    expect(await h.store.getConversation("conversation")).toBeUndefined();
    expect(h.sent.at(-1)).toMatch(/deleted/i);
    assertLodgeVoice(h.sent);
  });

  it("confirms a reminder and treats 👍 as done", async () => {
    const h = harness();
    await start(h);
    await h.bridge.handle(inbound("remind me in 5 minutes", "remind-1"), h.port);
    expect((await h.store.getConversation("conversation"))?.pendingReminders?.[0]?.status).toBe("pending_confirm");
    await h.bridge.handle(inbound("YES", "remind-2"), h.port);
    expect((await h.store.getConversation("conversation"))?.pendingReminders?.[0]?.status).toBe("scheduled");
    await h.bridge.handle(inbound({ type: "unsupported", kind: "like" }, "remind-3"), h.port);
    expect((await h.store.getConversation("conversation"))?.pendingReminders?.[0]?.status).toBe("done");
    assertLodgeVoice(h.sent);
  });

  it("pins on ❤️ and explains on ❓", async () => {
    const h = harness();
    await start(h);
    await h.bridge.handle(inbound("Research this", "pin-q"), h.port);
    await h.bridge.handle(inbound({ type: "unsupported", kind: "love" }, "pin-love"), h.port);
    expect((await h.store.getConversation("conversation"))?.notebook?.length).toBeGreaterThan(0);
    await h.store.putConversation("conversation", {
      ...(await h.store.getConversation("conversation"))!,
      lastTrace: {
        at: NOW.toISOString(),
        checkedLive: true,
        steps: [{ tool: "search", outcome: "ok" }],
      },
    });
    await h.bridge.handle(inbound({ type: "unsupported", kind: "question" }, "pin-q2"), h.port);
    expect(h.sent.at(-1)).toMatch(/How I got that/i);
    assertLodgeVoice(h.sent);
  });

  it("appends the FirstRole link on a roles ask", async () => {
    const h = harness({
      roles: {
        findRoles: async () => [{
          company: "Example",
          title: "Intern",
          url: "https://careers.example.edu/intern",
          stillOpen: "open",
          matchReason: "internship, Dubai, posted this week",
        }],
      },
    });
    await start(h);
    await h.bridge.handle(inbound("any internships in Dubai?", "roles-1"), h.port);
    expect(h.sent.join("\n")).toContain(FIRSTROLE_URL);
    expect(h.sent.join("\n")).toMatch(/still open/i);
    assertLodgeVoice(h.sent);
  });

  it("pins a roles listing as an opportunity on ❤️", async () => {
    const h = harness({
      roles: {
        findRoles: async () => [{
          company: "Example",
          title: "Intern",
          url: "https://careers.example.edu/intern",
          stillOpen: "open",
          matchReason: "internship, Dubai",
        }],
      },
    });
    await start(h);
    await h.bridge.handle(inbound("any internships in Dubai?", "roles-pin"), h.port);
    await h.bridge.handle(inbound({ type: "unsupported", kind: "love" }, "roles-love"), h.port);
    const note = (await h.store.getConversation("conversation"))?.notebook?.[0];
    expect(note?.kind).toBe("opportunity");
    expect(note?.url).toBe("https://careers.example.edu/intern");
    assertLodgeVoice(h.sent);
  });

  it("lets what’s due leave an open check-in", async () => {
    const h = harness();
    await h.bridge.handle(inbound("START", "int-start"), h.port);
    await h.bridge.handle(inbound("what's due this week", "int-due"), h.port);
    expect((await h.store.getConversation("conversation"))?.checkInStep).toBe("done");
    expect(h.sent.at(-1)).toMatch(/course page|syllabus/i);
    assertLodgeVoice(h.sent);
  });

  it("keeps HELP in Lodge voice with the FirstRole door", async () => {
    const h = harness();
    await start(h);
    await h.bridge.handle(inbound("HELP", "help-1"), h.port);
    expect(h.sent.at(-1)).toMatch(/Lodge/i);
    expect(h.sent.at(-1)).toContain(FIRSTROLE_URL);
    expect(h.sent.at(-1)).toMatch(/reopen/i);
    assertLodgeVoice(h.sent);
  });

  it("injects notebook tools into Gemma LodgeAgent", async () => {
    const client: LodgeModelClient = {
      complete: vi.fn(async (input) => {
        const last = input.messages.at(-1);
        if (last && "role" in last && last.role === "user") {
          return {
            ok: true,
            finishReason: "tool_calls",
            toolCalls: [toolCall("n1", "notebook", { action: "note", text: "Baker 102" })],
          } satisfies OpenRouterToolCompletion;
        }
        return {
          ok: true,
          finishReason: "stop",
          content: "Noted Baker 102.",
          toolCalls: [],
        } satisfies OpenRouterToolCompletion;
      }),
    };
    const tinyfish = {
      search: vi.fn(async () => []),
      fetch: vi.fn(async (url: string) => ({ title: "page", url, text: "ok" })),
      agent: vi.fn(async (input: { url: string }) => ({
        title: "page",
        url: input.url,
        excerpt: "ok",
        stillOpen: "unverified" as const,
      })),
    };
    const h = harness({
      tinyfish,
      createAgent: (localTools) => new LodgeAgent({
        client,
        tinyfish,
        localTools,
        now: () => NOW,
      }),
    });
    await start(h);
    await h.bridge.handle(inbound("Please remember Baker 102", "agent-note"), h.port);
    expect((await h.store.getConversation("conversation"))?.notebook?.[0]?.text).toMatch(/Baker 102/);
    expect(h.sent.join("\n")).toMatch(/Noted Baker 102/);
    expect(h.research.research).not.toHaveBeenCalled();
    assertLodgeVoice(h.sent);
  });
});

function toolCall(id: string, name: string, args: unknown): LodgeToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}
