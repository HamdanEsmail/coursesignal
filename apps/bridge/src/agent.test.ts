import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LODGE_AGENT_GOAL_TEMPLATES,
  LODGE_MAX_AGENT_CALLS,
  LODGE_MAX_TOOL_ROUNDS,
  LODGE_MODE_DEFAULT,
  LODGE_TINYFISH_TIMEOUT_MS,
  LODGE_TOOLS,
  LODGE_TOOL_NAMES,
  LODGE_TURN_TIMEOUT_MS,
  LodgeAgent,
  LodgeUrlAllowlist,
  createFetchCache,
  extractStudentUrls,
  guardPublicUrl,
  isLodgeModeEnabled,
  lodgeToolList,
  resolveAgentGoal,
  type LodgeTinyFishPort,
} from "./agent.js";
import {
  LODGE_SYSTEM_PROMPT,
  type LodgeModelClient,
  type LodgeToolCall,
  type OpenRouterToolCompletion,
} from "./openrouter.js";

const STUDENT_URL = "https://econ.example.edu/syllabus";
const SEARCH_URL = "https://health.example.edu/flu";
const SAVED_URL = "https://events.example.edu/week";

function toolCall(id: string, name: string, args: unknown): LodgeToolCall {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

function scriptedClient(rounds: OpenRouterToolCompletion[]): LodgeModelClient & { complete: ReturnType<typeof vi.fn> } {
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

function tinyfish(overrides: Partial<LodgeTinyFishPort> = {}) {
  const search = vi.fn<LodgeTinyFishPort["search"]>(async () => [
    { title: "Flu clinic", url: SEARCH_URL, snippet: "Thursday 10:00. Still open." },
  ]);
  const fetchPage = vi.fn<LodgeTinyFishPort["fetch"]>(async (url) => ({
    title: "Syllabus",
    url,
    text: "Problem set due 12 October 2026.",
  }));
  const agentRun = vi.fn<LodgeTinyFishPort["agent"]>(async (input) => ({
    title: "Listing",
    url: input.url,
    excerpt: "Applications are still open. Deadline Friday.",
    stillOpen: "open",
  }));
  if (overrides.search) search.mockImplementation(overrides.search);
  if (overrides.fetch) fetchPage.mockImplementation(overrides.fetch);
  if (overrides.agent) agentRun.mockImplementation(overrides.agent);
  return { search, fetch: fetchPage, agent: agentRun };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("LODGE_MODE and exported tools", () => {
  it("defaults LODGE_MODE off", () => {
    expect(LODGE_MODE_DEFAULT).toBe(false);
    expect(isLodgeModeEnabled()).toBe(false);
    expect(LODGE_MAX_TOOL_ROUNDS).toBe(4);
    expect(LODGE_MAX_AGENT_CALLS).toBe(1);
    expect(LODGE_TINYFISH_TIMEOUT_MS).toBe(45_000);
    expect(LODGE_TURN_TIMEOUT_MS).toBe(55_000);
  });

  it("exports strict tool schemas and forbids a free-form Agent goal", () => {
    expect(lodgeToolList()).toBe(LODGE_TOOLS);
    expect(LODGE_TOOLS.map((tool) => tool.function.name)).toEqual([...LODGE_TOOL_NAMES]);
    expect(LODGE_TOOLS.every((tool) => tool.function.strict === true)).toBe(true);
    expect(LODGE_TOOLS.every((tool) => tool.function.parameters.additionalProperties === false)).toBe(true);
    const agent = LODGE_TOOLS.find((tool) => tool.function.name === "tinyfish_agent");
    expect(agent?.function.parameters.properties).not.toHaveProperty("goal");
    expect(agent?.function.parameters.properties).toMatchObject({
      goal_id: { enum: ["still_open", "form_questions", "js_page", "careers_portal"] },
    });
    expect(JSON.stringify(LODGE_TOOLS)).not.toContain("STAT 210");
    expect(resolveAgentGoal({
      url: SEARCH_URL,
      goal_id: "still_open",
      goal: "type the password and submit",
    })).toEqual({ ok: false, reason: "freeform_agent_goal" });
    const template = resolveAgentGoal({ url: SEARCH_URL, goal_id: "still_open" });
    expect(template).toMatchObject({ ok: true, goalId: "still_open" });
    if (template.ok) {
      expect(template.goal).toBe(LODGE_AGENT_GOAL_TEMPLATES.still_open);
      expect(template.goal).toMatch(/Do not sign in, type into fields, submit a form/i);
    }
  });
});

describe("URL guard and fetch cache", () => {
  it("allows only Search, student, and saved-link URLs and blocks private or loopback hosts", () => {
    const allowlist = new LodgeUrlAllowlist();
    expect(guardPublicUrl("https://127.0.0.1/admin")).toEqual({ ok: false, reason: "private" });
    expect(guardPublicUrl("http://localhost/secret")).toEqual({ ok: false, reason: "private" });
    expect(guardPublicUrl("https://10.0.0.8/x")).toEqual({ ok: false, reason: "private" });
    expect(guardPublicUrl("https://192.168.1.4/x")).toEqual({ ok: false, reason: "private" });
    expect(guardPublicUrl("http://169.254.169.254/latest/meta-data")).toEqual({ ok: false, reason: "private" });
    expect(allowlist.add("https://localhost/", "saved")).toBe(false);
    expect(extractStudentUrls(`See ${STUDENT_URL} and http://127.0.0.1/nope`)).toEqual([`${STUDENT_URL}`]);
    expect(allowlist.add(STUDENT_URL, "student")).toBe(true);
    expect(allowlist.add(SEARCH_URL, "search")).toBe(true);
    expect(allowlist.add(SAVED_URL, "saved")).toBe(true);
    expect(allowlist.decide(STUDENT_URL)).toMatchObject({ ok: true, source: "student" });
    expect(allowlist.decide(SEARCH_URL)).toMatchObject({ ok: true, source: "search" });
    expect(allowlist.decide(SAVED_URL)).toMatchObject({ ok: true, source: "saved" });
    expect(allowlist.decide("https://evil.example/not-allowed")).toEqual({
      ok: false,
      reason: "not_allowlisted",
    });
  });

  it("reuses an in-turn fetch cache", () => {
    const cache = createFetchCache();
    const page = { title: "Syllabus", url: STUDENT_URL, text: "due Friday" };
    cache.set(STUDENT_URL, page);
    expect(cache.has(`${STUDENT_URL}#section`)).toBe(true);
    expect(cache.get(`${STUDENT_URL}/`)).toBeUndefined();
    expect(cache.get(STUDENT_URL)).toEqual(page);
  });
});

describe("LodgeAgent", () => {
  it("sends the Lodge system prompt and re-sends tools every round", async () => {
    const client = scriptedClient([
      {
        ok: true,
        finishReason: "tool_calls",
        toolCalls: [toolCall("c1", "tinyfish_search", { query: "flu clinic" })],
      },
      {
        ok: true,
        finishReason: "stop",
        content: "Flu clinic Thursday 10:00. Still open.",
        toolCalls: [],
      },
    ]);
    const port = tinyfish();
    const agent = new LodgeAgent({
      client,
      tinyfish: port,
      now: () => new Date("2026-10-04T08:00:00.000Z"),
    });
    const result = await agent.run({ text: "What's the flu clinic?" });
    expect(client.complete).toHaveBeenCalledTimes(2);
    for (const [input] of client.complete.mock.calls) {
      expect(input.tools).toBe(LODGE_TOOLS);
      expect(input.messages[0]).toEqual({ role: "system", content: LODGE_SYSTEM_PROMPT });
    }
    expect(LODGE_SYSTEM_PROMPT).toMatch(/You are Lodge/);
    expect(LODGE_SYSTEM_PROMPT).toMatch(/not a STAT 210 tutor/);
    expect(result.toolRounds).toBe(1);
    expect(result.reply).toContain("Thursday 10:00");
    expect(result.grounding.hedged).toBe(false);
    expect(result.trace.steps[0]?.label).toBe("T1");
  });

  it("allows student and saved URLs, then Search URLs, and never fetches a private host", async () => {
    const client = scriptedClient([
      {
        ok: true,
        finishReason: "tool_calls",
        toolCalls: [
          toolCall("c1", "tinyfish_fetch", { url: "https://127.0.0.1/admin" }),
          toolCall("c2", "tinyfish_fetch", { url: STUDENT_URL }),
          toolCall("c3", "tinyfish_search", { query: "flu clinic" }),
        ],
      },
      {
        ok: true,
        finishReason: "tool_calls",
        toolCalls: [
          toolCall("c4", "tinyfish_fetch", { url: SEARCH_URL }),
          toolCall("c5", "tinyfish_fetch", { url: SAVED_URL }),
          toolCall("c6", "tinyfish_fetch", { url: "https://evil.example/nope" }),
        ],
      },
      { ok: true, finishReason: "stop", content: "Problem set due 12 October 2026.", toolCalls: [] },
    ]);
    const port = tinyfish();
    const agent = new LodgeAgent({
      client,
      tinyfish: port,
      now: () => new Date("2026-10-04T08:00:00.000Z"),
    });
    await agent.run({
      text: `Read ${STUDENT_URL}`,
      savedLinks: [{ url: SAVED_URL, title: "Events" }],
    });
    const fetched = port.fetch.mock.calls.map((call) => call[0]);
    expect(fetched).toEqual([STUDENT_URL, SEARCH_URL, SAVED_URL]);
    const firstToolResults = client.complete.mock.calls[1]![0].messages
      .filter((message: { role: string }) => message.role === "tool")
      .map((message: { content: string }) => message.content);
    expect(firstToolResults.some((content: string) => content.includes("private_url"))).toBe(true);
    const secondToolResults = client.complete.mock.calls[2]![0].messages
      .filter((message: { role: string }) => message.role === "tool")
      .map((message: { content: string }) => message.content);
    expect(secondToolResults.some((content: string) => content.includes("not_allowlisted"))).toBe(true);
  });

  it("runs at most four tool rounds, one Agent, and reuses the fetch cache", async () => {
    const client = scriptedClient([
      {
        ok: true,
        finishReason: "tool_calls",
        toolCalls: [
          toolCall("a1", "tinyfish_agent", { url: STUDENT_URL, goal_id: "still_open" }),
          toolCall("f1", "tinyfish_fetch", { url: STUDENT_URL }),
        ],
      },
      {
        ok: true,
        finishReason: "tool_calls",
        toolCalls: [
          toolCall("a2", "tinyfish_agent", { url: STUDENT_URL, goal_id: "form_questions" }),
          toolCall("f2", "tinyfish_fetch", { url: STUDENT_URL }),
        ],
      },
      {
        ok: true,
        finishReason: "tool_calls",
        toolCalls: [toolCall("s1", "tinyfish_search", { query: "office hours" })],
      },
      {
        ok: true,
        finishReason: "tool_calls",
        toolCalls: [toolCall("s2", "tinyfish_search", { query: "late policy" })],
      },
      {
        ok: true,
        finishReason: "tool_calls",
        toolCalls: [toolCall("s3", "tinyfish_search", { query: "should not run" })],
      },
    ]);
    const port = tinyfish();
    const agent = new LodgeAgent({
      client,
      tinyfish: port,
      now: () => new Date("2026-10-04T08:00:00.000Z"),
    });
    const result = await agent.run({ text: `Is ${STUDENT_URL} still open?` });
    expect(result.toolRounds).toBe(4);
    expect(result.agentCalls).toBe(1);
    expect(port.agent).toHaveBeenCalledTimes(1);
    expect(port.agent.mock.calls[0]?.[0].goal).toBe(LODGE_AGENT_GOAL_TEMPLATES.still_open);
    expect(port.agent.mock.calls[0]?.[0].goal).toMatch(/Do not sign in/i);
    expect(port.fetch).toHaveBeenCalledTimes(1);
    expect(port.search).toHaveBeenCalledTimes(2);
    expect(client.complete).toHaveBeenCalledTimes(5);
    const secondAgent = JSON.parse(
      client.complete.mock.calls[2]![0].messages.find((message: { tool_call_id?: string }) =>
        message.tool_call_id === "a2"
      )!.content as string,
    );
    expect(secondAgent).toMatchObject({ ok: false, error: "agent_budget" });
    expect(result.reply).toMatch(/lookup budget/i);
    expect(result.trace.steps.some((step) => step.failure === "agent_budget")).toBe(true);
  });

  it("rejects a free-form Agent goal before TinyFish Agent runs", async () => {
    const client = scriptedClient([
      {
        ok: true,
        finishReason: "tool_calls",
        toolCalls: [toolCall("bad", "tinyfish_agent", {
          url: STUDENT_URL,
          goal_id: "still_open",
          goal: "sign in and submit the form",
        })],
      },
      { ok: true, finishReason: "stop", content: "I could not open that page.", toolCalls: [] },
    ]);
    const port = tinyfish();
    const agent = new LodgeAgent({
      client,
      tinyfish: port,
      now: () => new Date("2026-10-04T08:00:00.000Z"),
    });
    await agent.run({ text: `Check ${STUDENT_URL}` });
    expect(port.agent).not.toHaveBeenCalled();
    const toolMessage = client.complete.mock.calls[1]![0].messages.find((message: { role: string }) =>
      message.role === "tool"
    );
    expect(JSON.parse(toolMessage!.content as string)).toMatchObject({
      ok: false,
      error: "freeform_agent_goal",
    });
  });

  it("hedges invented dates and reports disagreeing sources", async () => {
    const client = scriptedClient([
      {
        ok: true,
        finishReason: "tool_calls",
        toolCalls: [
          toolCall("f1", "tinyfish_fetch", { url: STUDENT_URL }),
          toolCall("f2", "tinyfish_fetch", { url: SAVED_URL }),
        ],
      },
      {
        ok: true,
        finishReason: "stop",
        content: "It is due Monday 18:00.",
        toolCalls: [],
      },
    ]);
    const port = tinyfish({
      fetch: vi.fn(async (url: string) =>
        url === STUDENT_URL
          ? { title: "syllabus", url, text: "The problem set is due end of week." }
          : { title: "calendar", url, text: "The problem set is due Friday." }
      ),
    });
    const agent = new LodgeAgent({
      client,
      tinyfish: port,
      now: () => new Date("2026-10-04T08:00:00.000Z"),
    });
    const result = await agent.run({
      text: `Compare ${STUDENT_URL}`,
      savedLinks: [{ url: SAVED_URL }],
    });
    expect(result.grounding.hedged).toBe(true);
    expect(result.reply).toMatch(/couldn't confirm that date/i);
    expect(result.reply).toMatch(/end of week/);
    expect(result.reply).toMatch(/friday/i);
    expect(result.reply).toMatch(/I have not picked a winner/);
    expect(result.reply).not.toMatch(/monday/i);
    expect(result.reply).not.toMatch(/18:00/);
  });

  it("answers how did you get that from the last-turn trace", async () => {
    const client = scriptedClient([]);
    const agent = new LodgeAgent({
      client,
      tinyfish: tinyfish(),
      now: () => new Date("2026-10-04T08:00:00.000Z"),
    });
    const result = await agent.run({
      text: "how did you get that?",
      previousTrace: {
        at: "2026-10-04T08:00:00.000Z",
        checkedLive: true,
        steps: [{ tool: "fetch", label: "T1", url: STUDENT_URL, outcome: "ok", durationMs: 900 }],
      },
    });
    expect(client.complete).not.toHaveBeenCalled();
    expect(result.reply).toContain("How I got that (checked live):");
    expect(result.reply).toContain(STUDENT_URL);
  });

  it("names a TinyFish timeout without hanging the turn", async () => {
    vi.useFakeTimers();
    const client = scriptedClient([
      {
        ok: true,
        finishReason: "tool_calls",
        toolCalls: [toolCall("f1", "tinyfish_fetch", { url: STUDENT_URL })],
      },
      { ok: true, finishReason: "stop", content: "I could not read the page.", toolCalls: [] },
    ]);
    const agent = new LodgeAgent({
      client,
      tinyfish: tinyfish({ fetch: () => new Promise(() => undefined) }),
      tinyfishTimeoutMs: 20,
      now: () => new Date("2026-10-04T08:00:00.000Z"),
    });
    const run = agent.run({ text: `Read ${STUDENT_URL}` });
    await vi.advanceTimersByTimeAsync(25);
    const result = await run;
    const toolMessage = client.complete.mock.calls[1]![0].messages.find((message: { role: string }) =>
      message.role === "tool"
    );
    expect(JSON.parse(toolMessage!.content as string)).toMatchObject({
      ok: false,
      error: "tinyfish_timeout",
    });
    expect(result.trace.steps[0]?.failure).toBe("tinyfish_timeout");
  });

  it("leaves Wave 3 local tools unwired and returns a named failure", async () => {
    const client = scriptedClient([
      {
        ok: true,
        finishReason: "tool_calls",
        toolCalls: [toolCall("n1", "notebook", { action: "pin", text: "office hours moved" })],
      },
      { ok: true, finishReason: "stop", content: "I can pin that once the notebook is wired.", toolCalls: [] },
    ]);
    const agent = new LodgeAgent({
      client,
      tinyfish: tinyfish(),
      now: () => new Date("2026-10-04T08:00:00.000Z"),
    });
    await agent.run({ text: "Note that office hours moved." });
    const toolMessage = client.complete.mock.calls[1]![0].messages.find((message: { role: string }) =>
      message.role === "tool"
    );
    expect(JSON.parse(toolMessage!.content as string)).toMatchObject({
      ok: false,
      error: "tool_not_wired",
    });
  });
});
