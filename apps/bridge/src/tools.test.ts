import { describe, expect, it, vi } from "vitest";
import { LodgeAgent, type LodgeTinyFishPort } from "./agent.js";
import { InMemoryBridgeStore } from "./store.js";
import {
  FIRSTROLE_URL,
  TINYFISH_DESK,
  createLodgeTools,
  formatLodgeToolContent,
  parseReminderWhen,
  type LodgeRoleListing,
} from "./tools.js";
import type { ConversationMemory } from "./types.js";
import type { LodgeModelClient, LodgeToolCall, OpenRouterToolCompletion } from "./openrouter.js";

const NOW = new Date("2026-10-04T08:00:00.000Z");
const COURSE = "https://econ.example.edu/syllabus";
const CALENDAR = "https://econ.example.edu/calendar";
const FORM = "https://jobs.example.edu/apply";

function toolCall(id: string, name: string, args: unknown): LodgeToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function scriptedClient(rounds: OpenRouterToolCompletion[]): LodgeModelClient {
  const complete = vi.fn();
  for (const round of rounds) complete.mockResolvedValueOnce(round);
  complete.mockResolvedValue({
    ok: true,
    finishReason: "stop",
    content: "Done.",
    toolCalls: [],
  } satisfies OpenRouterToolCompletion);
  return { complete };
}

function tinyfish(overrides: Partial<LodgeTinyFishPort> = {}): LodgeTinyFishPort {
  return {
    search: overrides.search ?? (async () => []),
    fetch: overrides.fetch ?? (async (url) => ({
      title: "Syllabus",
      url,
      text: url === COURSE
        ? `Problem set due Friday 17:00.\nCalendar: ${CALENDAR}`
        : "Calendar due Friday 17:00.",
    })),
    agent: overrides.agent ?? (async (input) => ({
      title: "Form",
      url: input.url,
      excerpt: "Q1 name. Q2 résumé. Deadline Friday. Still open.",
      stillOpen: "open",
    })),
  };
}

function memory(overrides: Partial<ConversationMemory> = {}): ConversationMemory {
  return {
    consentedAt: NOW.toISOString(),
    consentVersion: 4,
    courses: [],
    watches: [],
    updatedAt: NOW.toISOString(),
    timezone: "Asia/Dubai",
    savedLinks: [{
      id: "20000000-0000-4000-8000-000000000002",
      kind: "course",
      url: COURSE,
      createdAt: NOW.toISOString(),
    }],
    notebook: [],
    pendingReminders: [],
    ...overrides,
  };
}

describe("Lodge tools", () => {
  it("aliases TinyFish Search/Fetch/Agent and never mentions Browser or CourseSignal", () => {
    expect(TINYFISH_DESK).toEqual({
      search_web: "tinyfish_search",
      read_pages: "tinyfish_fetch",
      browse_page: "tinyfish_agent",
    });
    expect(JSON.stringify(TINYFISH_DESK)).not.toMatch(/browser|CourseSignal|STAT 210/i);
    expect(FIRSTROLE_URL).toBe("https://firstrole.hamdanesmail12-7a9.workers.dev");
  });

  it("reads what’s due, follows at most two child links, and stays offline-mocked", async () => {
    const store = new InMemoryBridgeStore();
    await store.putConversation("chat", memory());
    const fetch = vi.fn(async (url: string) => ({
      title: url === CALENDAR ? "Calendar" : "Syllabus",
      url,
      text: url === COURSE
        ? `Due Friday.\nSee ${CALENDAR}`
        : "Problem set due Friday 17:00.",
    }));
    const tools = createLodgeTools({
      store,
      conversationKey: "chat",
      now: () => NOW,
      tinyfish: tinyfish({ fetch }),
    });
    const result = await tools.execute("whats_due", {});
    const parsed = JSON.parse(result.content) as { ok: boolean; pages: string[] };
    expect(parsed.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(parsed.pages).toEqual([COURSE, CALENDAR]);
    expect(result.citations?.some((citation) => citation.tool === "fetch")).toBe(true);
  });

  it("names a blocked events-page Fetch instead of throwing", async () => {
    const store = new InMemoryBridgeStore();
    await store.putConversation("chat", memory({
      savedLinks: [{
        id: "20000000-0000-4000-8000-000000000003",
        kind: "events",
        url: "https://www.aus.edu/media/events",
        createdAt: NOW.toISOString(),
      }],
    }));
    const tools = createLodgeTools({
      store,
      conversationKey: "chat",
      now: () => NOW,
      tinyfish: tinyfish({
        fetch: async () => {
          throw new Error("TinyFish Fetch bot_blocked");
        },
      }),
    });
    const result = await tools.execute("whats_on", {});
    const parsed = JSON.parse(result.content) as { ok: boolean; error: string };
    expect(parsed).toEqual({ ok: false, error: "page_blocked" });
    expect(formatLodgeToolContent("whats_on", result.content).bubbles[0])
      .toMatch(/blocked a fetch/i);
  });

  it("walks a form read-only, drafts without sending, and never emails", async () => {
    const store = new InMemoryBridgeStore();
    await store.putConversation("chat", memory());
    const agent = vi.fn(async (input: { url: string; goal: string }) => {
      expect(input.goal).toMatch(/Never type answers or submit/i);
      return {
        title: "Apply",
        url: input.url,
        excerpt: "Questions: name, résumé. Still open.",
        stillOpen: "open" as const,
      };
    });
    const tools = createLodgeTools({
      store,
      conversationKey: "chat",
      now: () => NOW,
      tinyfish: tinyfish({ agent }),
    });
    const form = JSON.parse((await tools.execute("read_form", { url: FORM })).content) as {
      ok: boolean;
      note: string;
    };
    expect(form.ok).toBe(true);
    expect(form.note).toMatch(/never applies/i);
    expect(agent).toHaveBeenCalledOnce();

    const blocked = JSON.parse((await tools.execute("draft_message", {
      audience: "prof@example.edu",
      topic: "extension",
    })).content) as { ok: boolean; error: string };
    expect(blocked).toMatchObject({ ok: false, error: "contact_not_allowed" });

    const draft = JSON.parse((await tools.execute("draft_message", {
      audience: "professor",
      topic: "office hours",
    })).content) as { ok: boolean; sent: boolean; draft: string };
    expect(draft.ok).toBe(true);
    expect(draft.sent).toBe(false);
    expect(draft.draft).toMatch(/professor/i);
  });

  it("confirms a 5-minute reminder in local time and builds calendar links without adding", async () => {
    const store = new InMemoryBridgeStore();
    await store.putConversation("chat", memory());
    const tools = createLodgeTools({ store, conversationKey: "chat", now: () => NOW });
    const reminded = JSON.parse((await tools.execute("remind_me", {
      text: "Flu clinic",
      when: "in 5 minutes",
    })).content) as { ok: boolean; localFireLabel: string };
    expect(reminded.ok).toBe(true);
    expect(reminded.localFireLabel).toMatch(/Today, 12:05/);
    expect((await store.getConversation("chat"))?.pendingReminders?.[0]?.ignoreQuietHours).toBe(true);
    expect((await store.getConversation("chat"))?.pendingReminders?.[0]?.status).toBe("pending_confirm");

    const fire = parseReminderWhen("in 5 minutes", NOW, "Asia/Dubai");
    expect(fire?.toISOString()).toBe("2026-10-04T08:05:00.000Z");

    const calendar = JSON.parse((await tools.execute("add_to_calendar", {
      title: "Flu clinic",
      start: "2026-10-08T08:00:00.000Z",
      end: "2026-10-08T09:00:00.000Z",
      location: "Health Center",
      url: "https://health.example.edu/flu",
    })).content) as { ok: boolean; saveHint: string; google: { url: string } };
    expect(calendar.ok).toBe(true);
    expect(calendar.saveHint).toMatch(/never adds/i);
    expect(calendar.google.url).toContain("calendar.google.com");
  });

  it("appends the FirstRole link even when the roles desk is a stub", async () => {
    const store = new InMemoryBridgeStore();
    await store.putConversation("chat", memory());
    const tools = createLodgeTools({ store, conversationKey: "chat", now: () => NOW });
    const result = await tools.execute("find_roles", { query: "internship", city: "Dubai" });
    const formatted = formatLodgeToolContent("find_roles", result.content);
    expect(formatted.bubbles.join("\n")).toContain(FIRSTROLE_URL);
    expect(formatted.bubbles.join("\n")).not.toMatch(/I applied for you|CourseSignal/i);
  });

  it("injects local tools into LodgeAgent so notebook pin is wired", async () => {
    const store = new InMemoryBridgeStore();
    await store.putConversation("chat", memory());
    const localTools = createLodgeTools({ store, conversationKey: "chat", now: () => NOW });
    const client = scriptedClient([
      {
        ok: true,
        finishReason: "tool_calls",
        toolCalls: [toolCall("n1", "notebook", { action: "note", text: "office hours moved" })],
      },
      { ok: true, finishReason: "stop", content: "Noted.", toolCalls: [] },
    ]);
    const agent = new LodgeAgent({
      client,
      tinyfish: tinyfish(),
      localTools,
      now: () => NOW,
    });
    const result = await agent.run({ text: "Note that office hours moved." });
    expect(result.reply).toMatch(/Noted/i);
    expect((await store.getConversation("chat"))?.notebook?.[0]?.text).toMatch(/office hours moved/i);
  });

  it("uses an injected roles finder for 1–3 listings and still appends FirstRole", async () => {
    const listings: LodgeRoleListing[] = [{
      company: "Example",
      title: "Summer intern",
      url: "https://careers.example.edu/intern",
      stillOpen: "open",
      matchReason: "internship, Dubai, posted this week",
    }];
    const store = new InMemoryBridgeStore();
    await store.putConversation("chat", memory());
    const tools = createLodgeTools({
      store,
      conversationKey: "chat",
      now: () => NOW,
      roles: { findRoles: async () => listings },
    });
    const formatted = formatLodgeToolContent(
      "find_roles",
      (await tools.execute("find_roles", { query: "internship", city: "Dubai" })).content,
    );
    expect(formatted.bubbles[0]).toMatch(/Example: Summer intern \(still open\)/);
    expect(formatted.bubbles.at(-1)).toContain(FIRSTROLE_URL);
  });

  it("runs the FirstRole-shaped desk through mocked TinyFish when no finder is injected", async () => {
    const url = "https://careers.northquay.example/jobs/summer-internship-dubai";
    const store = new InMemoryBridgeStore();
    await store.putConversation("chat", memory());
    const search = vi.fn(async () => [{
      title: "Summer internship Dubai",
      url,
      snippet: "internship Dubai",
    }]);
    const fetch = vi.fn(async () => ({
      title: "Summer internship at North Quay Studio",
      url,
      text: [
        "# Summer internship",
        "Company: North Quay Studio",
        "Location: Dubai",
        "Posted 1 October 2026",
        "Apply now",
        "Applications are still open.",
      ].join("\n"),
    }));
    const tools = createLodgeTools({
      store,
      conversationKey: "chat",
      now: () => NOW,
      tinyfish: tinyfish({ search, fetch }),
    });
    const formatted = formatLodgeToolContent(
      "find_roles",
      (await tools.execute("find_roles", { query: "internship", city: "Dubai" })).content,
    );
    expect(formatted.bubbles[0]).toMatch(/North Quay Studio/);
    expect(formatted.bubbles[0]).toMatch(/still open/i);
    expect(formatted.bubbles.at(-1)).toContain(FIRSTROLE_URL);
    expect((await store.getConversation("chat"))?.lastResearch?.topic).toBe("roles");

    const pinned = JSON.parse((await tools.execute("notebook", { action: "pin", text: null })).content) as {
      ok: boolean;
      message: string;
    };
    expect(pinned.ok).toBe(true);
    expect(pinned.message).toMatch(/Pinned 1 opening/);
    expect((await store.getConversation("chat"))?.notebook?.[0]).toMatchObject({
      kind: "opportunity",
      url,
    });
  });
});
