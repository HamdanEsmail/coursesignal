import { describe, expect, it, vi } from "vitest";
import {
  BoundedAgentEscalator,
  TinyFishGateway,
  TinyFishResearchService,
  buildSearchQuery,
  classifyStudentIntent,
  cleanReceiptText,
  compact,
  displaySourceName,
  displaySourceTitle,
  exampleQuality,
  researchReply,
  sourceScore,
  type AgentRunner,
  type AnswerComposer,
  type SearchFetchGateway,
} from "./research.js";

const FIXED_NOW = new Date("2026-10-01T18:00:00.000Z");

function gateway(overrides: Partial<SearchFetchGateway> = {}): SearchFetchGateway {
  return {
    search: vi.fn(async () => [
      {
        title: "Probability course notes",
        url: "https://math.example.edu/notes",
        snippet: "Authoritative university notes about conditional probability and examples.",
      },
    ]),
    fetch: vi.fn(async () => [
      {
        title: "Probability course notes",
        url: "https://math.example.edu/notes",
        text: "Conditional probability restricts the sample space to the event that is known to have occurred, then normalizes the remaining outcomes.",
      },
    ]),
    ...overrides,
  };
}

describe("compact", () => {
  it("normalizes whitespace and truncates with an ellipsis", () => {
    expect(compact("a   b   c", 4)).toBe("a b…");
  });
});

describe("source quality", () => {
  it("drops homework mills and literal IP hosts", () => {
    expect(sourceScore({
      title: "Conditional Probability | Definition, Equation & Examples",
      url: "https://study.com/learn/lesson/conditional-probability-concept-examples.html",
    })).toBe(-100);
    expect(sourceScore({
      title: "Untitled source",
      url: "https://137.99.146.236/wp-content/uploads/sites/2187/2018/01/prob3160ch4.pdf",
    })).toBe(-100);
  });

  it("prefers open textbooks over SEO lesson pages", () => {
    const open = sourceScore({
      title: "Conditional Probability",
      url: "https://www.probabilitycourse.com/chapter1/1_4_0_conditional_probability.php",
    }, "course_concept");
    const mill = sourceScore({
      title: "Conditional Probability | Definition, Equation & Examples - Lesson",
      url: "https://study.com/learn/lesson/conditional-probability-concept-examples.html",
    }, "course_concept");
    expect(open).toBeGreaterThan(0);
    expect(mill).toBe(-100);
    expect(open).toBeGreaterThan(mill);
  });

  it("scores a numeric classroom problem above a qualitative story", () => {
    const rainy = "Suppose that in a certain city, 23 percent of the days are rainy. P(R)=0.23.";
    const smoker = "For example, the first event is a person being a smoker and the second is having lung cancer.";
    expect(exampleQuality(rainy)).toBeGreaterThan(exampleQuality(smoker));
  });

  it("strips markdown and LaTeX from receipts and avoids TLD names in the footer", () => {
    expect(cleanReceiptText("## 1.4.0 Conditional Probability $P(R)=0.23$ \\textrm{where} R is rain.")).toContain("P(R)=0.23");
    expect(cleanReceiptText("## 1.4.0 Conditional Probability $P(R)=0.23$ \\textrm{where} R is rain.")).not.toContain("##");
    expect(cleanReceiptText("## 1.4.0 Conditional Probability $P(R)=0.23$ \\textrm{where} R is rain.")).not.toContain("textrm");
    expect(displaySourceName({
      title: "Conditional Probability | Definition, Equation & Examples - Lesson | Study.com",
      url: "https://study.com/learn/lesson/x.html",
    })).not.toMatch(/\.[a-z]{2,}$/i);
    expect(displaySourceName({
      title: "Introductory Statistics",
      url: "https://openstax.org/books/introductory-statistics",
    })).toBe("OpenStax");
    expect(displaySourceTitle("PowerPoint Presentation", "https://uomustansiriyah.edu.iq/media/lectures/cond.pdf")).not.toMatch(/powerpoint/i);
  });

  it("ranks a readable course page above a lecture PDF", () => {
    const html = sourceScore({
      title: "Conditional Probability",
      url: "https://www.probabilitycourse.com/chapter1/1_4_0_conditional_probability.php",
    }, "course_concept");
    const pdf = sourceScore({
      title: "PowerPoint Presentation",
      url: "https://uomustansiriyah.edu.iq/media/lectures/5/cond.pdf",
    }, "course_concept");
    expect(html).toBeGreaterThan(pdf);
  });
});

describe("researchReply", () => {
  it("supports the existing credentialless echo proof", async () => {
    await expect(researchReply("echo iphone proof")).resolves.toEqual({
      body: "echo: iphone proof",
      endpoints: [],
      sourceUrls: [],
    });
  });

  it("asks for a meaningful query before creating a provider client", async () => {
    const result = await researchReply("research");
    expect(result.endpoints).toEqual([]);
    expect(result.body).toMatch(/student-life question/i);
  });
});

describe("TinyFish Fetch Highlights", () => {
  function tinyFishClient(getContents: ReturnType<typeof vi.fn>) {
    return {
      fetch: { getContents },
      search: { query: vi.fn() },
      agent: { run: vi.fn() },
    } as unknown as ConstructorParameters<typeof TinyFishGateway>[0];
  }

  function fetched(changes: Record<string, unknown> = {}) {
    return {
      results: [{
        url: "https://math.example.edu/notes",
        final_url: null,
        title: "Probability notes",
        description: null,
        language: "en",
        author: null,
        published_date: null,
        format: "markdown",
        text: null,
        highlights: [
          { text: "Second exact passage.", rank: 2 },
          { text: "First exact passage.", rank: 1 },
        ],
        ...changes,
      }],
      errors: [],
    };
  }

  it("requests up to three bounded query-ranked passages and preserves their wording", async () => {
    const getContents = vi.fn().mockResolvedValue(fetched());
    const gateway = new TinyFishGateway(tinyFishClient(getContents));
    const pages = await gateway.fetch(
      ["https://math.example.edu/notes"],
      "Explain conditional probability",
    );

    expect(getContents).toHaveBeenCalledOnce();
    expect(getContents).toHaveBeenCalledWith(expect.objectContaining({
      urls: ["https://math.example.edu/notes"],
      format: "markdown",
      highlights: {
        query: "Explain conditional probability",
        max_snippets: 3,
        max_characters: 700,
        include_full_page_text: false,
      },
    }));
    expect(pages[0]).toMatchObject({
      text: "",
      highlights: [
        { text: "First exact passage.", rank: 1 },
        { text: "Second exact passage.", rank: 2 },
      ],
    });
  });

  it("abandons a TinyFish Fetch that never returns", async () => {
    const getContents = vi.fn(() => new Promise(() => {}));
    const gateway = new TinyFishGateway(tinyFishClient(getContents), { timeoutMs: 25 });
    await expect(gateway.fetch(
      ["https://math.example.edu/notes"],
      "Explain conditional probability",
    )).rejects.toThrow(/timed out/i);
  });

  it.each([
    ["403 enrollment gate", { statusCode: 403, code: "PERMISSION_DENIED" }],
    [
      "explicit unsupported response",
      { statusCode: 422, code: "HIGHLIGHTS_UNSUPPORTED", message: "Highlights unsupported" },
    ],
  ])("falls back exactly once to ordinary Fetch for %s", async (_label, error) => {
    const getContents = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(fetched({
        text: "Full page fallback evidence from the official source.",
        highlights: undefined,
      }));
    const gateway = new TinyFishGateway(tinyFishClient(getContents));

    await expect(gateway.fetch(
      ["https://math.example.edu/notes"],
      "Explain conditional probability",
    )).resolves.toEqual([
      expect.objectContaining({ text: "Full page fallback evidence from the official source." }),
    ]);
    expect(getContents).toHaveBeenCalledTimes(2);
    expect(getContents.mock.calls[0]?.[0]).toHaveProperty("highlights");
    expect(getContents.mock.calls[1]?.[0]).not.toHaveProperty("highlights");
  });

  it("does not turn an unrelated failure into a Fetch retry loop", async () => {
    const getContents = vi.fn().mockRejectedValue(new Error("network unavailable"));
    const gateway = new TinyFishGateway(tinyFishClient(getContents));
    await expect(gateway.fetch(
      ["https://math.example.edu/notes"],
      "Explain conditional probability",
    )).rejects.toThrow("network unavailable");
    expect(getContents).toHaveBeenCalledOnce();
  });

  it("names a TinyFish bot_blocked empty Fetch instead of returning no pages", async () => {
    const getContents = vi.fn().mockResolvedValue({
      results: [],
      errors: [{ url: "https://www.aus.edu/media/events", error: "bot_blocked" }],
    });
    const gateway = new TinyFishGateway(tinyFishClient(getContents));
    await expect(gateway.fetch(
      ["https://www.aus.edu/media/events"],
      "Lodge public page read",
    )).rejects.toThrow(/bot_blocked/i);
  });

  it("passes the ranked highlight passages—not unrelated full-page text—to the composer", async () => {
    const composer: AnswerComposer = {
      compose: vi.fn(async () => ({ attempted: false })),
    };
    const provider = gateway({
      fetch: vi.fn(async () => [{
        title: "Probability notes",
        url: "https://math.example.edu/notes",
        text: "Unrelated navigation and full-page boilerplate.",
        highlights: [
          { text: "Conditional probability uses a restricted sample space.", rank: 1 },
          { text: "Divide the joint probability by the probability of the known event.", rank: 2 },
        ],
      }]),
    });
    const service = new TinyFishResearchService({
      gateway: provider,
      composer,
      now: () => FIXED_NOW,
    });

    const result = await service.research({
      query: "Explain conditional probability",
      mode: "answer",
    });
    expect(result.sources[0]?.excerpt).toBe(
      "Conditional probability uses a restricted sample space. Divide the joint probability by the probability of the known event.",
    );
    expect(composer.compose).toHaveBeenCalledWith(expect.objectContaining({
      sources: [expect.objectContaining({
        excerpt: "Conditional probability uses a restricted sample space. Divide the joint probability by the probability of the known event.",
      })],
    }));
    expect(result.body).not.toContain("Unrelated navigation");
  });
});

describe("TinyFishResearchService", () => {
  it("uses Search then Fetch and returns a receipt-ready answer", async () => {
    const provider = gateway();
    const working = new TinyFishResearchService({ gateway: provider, now: () => FIXED_NOW });
    const result = await working.research({
      query: "Explain conditional probability",
      mode: "answer",
      course: "STAT 210",
    });

    expect(provider.search).toHaveBeenCalledOnce();
    expect(provider.fetch).toHaveBeenCalledWith(
      ["https://math.example.edu/notes"],
      "Explain conditional probability",
    );
    expect(result.endpoints).toEqual(["search", "fetch"]);
    expect(result.body).toMatch(/^Conditional probability/);
    expect(result.body).toContain("Probability course notes");
    expect(result.body).toContain("Reply SOURCES for links, PLAN for a study path, or WATCH to track this page.");
    expect(result.body).not.toContain("Uncertainty:");
    expect(result.body).not.toMatch(/\[\d\]/);
    expect(result.body).not.toContain("https://math.example.edu/notes");
    expect(result.body.length).toBeLessThanOrEqual(900);
    expect(result.sources[0]?.endpoint).toBe("fetch");
  });

  it("fetches a supplied public URL before search results", async () => {
    const provider = gateway({
      fetch: vi.fn(async (urls: string[]) => urls.map((url: string) => ({
        title: "Syllabus",
        url,
        text: "This public syllabus contains the assessed topics, due dates, and required reading for the course.",
      }))),
    });
    const service = new TinyFishResearchService({ gateway: provider, now: () => FIXED_NOW });
    await service.research({
      query: "Check https://university.example/syllabus",
      mode: "answer",
    });

    expect(provider.fetch).toHaveBeenCalledWith([
      "https://university.example/syllabus",
      "https://math.example.edu/notes",
    ], "https://university.example/syllabus");
  });

  it("formats a plan without claiming it changed an external system", async () => {
    const service = new TinyFishResearchService({ gateway: gateway(), now: () => FIXED_NOW });
    const result = await service.research({ query: "Prepare for quiz 2", mode: "plan" });
    expect(result.body).toContain("STUDY PLAN");
    expect(result.body).toContain("ORIENT");
    expect(result.body).toContain("RECALL");
  });

  it("escalates only when Search and Fetch have no readable evidence", async () => {
    const agent = { extract: vi.fn(async () => ({
      title: "Interactive catalogue",
      url: "https://catalog.example.edu/course",
      excerpt: "The interactive catalogue lists the current course prerequisites and official credit hours.",
    })) };
    const service = new TinyFishResearchService({
      gateway: gateway({ fetch: vi.fn(async () => []) }),
      agent,
      now: () => FIXED_NOW,
    });
    const result = await service.research({ query: "current prerequisites", mode: "answer" });
    expect(agent.extract).toHaveBeenCalledOnce();
    expect(result.endpoints).toEqual(["search", "fetch", "agent"]);
    expect(result.sources[0]?.endpoint).toBe("agent");
  });

  it("does not spend an Agent run when Fetch produced evidence", async () => {
    const agent = { extract: vi.fn() };
    const service = new TinyFishResearchService({ gateway: gateway(), agent, now: () => FIXED_NOW });
    await service.research({ query: "conditional probability", mode: "answer" });
    expect(agent.extract).not.toHaveBeenCalled();
  });

  it("fetches a readable course page instead of a lecture PDF", async () => {
    const fetch = vi.fn(async (urls: string[]) => urls.map((url) => ({
      title: url.endsWith(".pdf") ? "PowerPoint Presentation" : "Conditional Probability",
      url,
      text: "Conditional probability is the chance of B once A is known. Notes write that as P(B|A).",
    })));
    const service = new TinyFishResearchService({
      gateway: {
        search: vi.fn(async () => [
          {
            title: "PowerPoint Presentation",
            url: "https://uomustansiriyah.edu.iq/media/lectures/cond.pdf",
            snippet: "Slides.",
          },
          {
            title: "Conditional Probability",
            url: "https://www.probabilitycourse.com/chapter1/1_4_0_conditional_probability.php",
            snippet: "Open course.",
          },
        ]),
        fetch,
      },
      now: () => FIXED_NOW,
    });
    const result = await service.research({
      query: "What is conditional probability in statistics?",
      mode: "answer",
    });
    expect(fetch.mock.calls[0]?.[0]).toEqual([
      "https://www.probabilitycourse.com/chapter1/1_4_0_conditional_probability.php",
    ]);
    expect(result.sources.every((source) => !source.url.endsWith(".pdf"))).toBe(true);
  });
});

describe("student intent routing and concise answers", () => {
  it.each([
    ["Explain conditional probability", "STAT 210", "course_concept"],
    ["What are the campus library hours?", undefined, "campus_service_event"],
    ["Find the correct textbook edition and ISBN", undefined, "textbook_resource"],
    ["Am I eligible for this scholarship?", undefined, "scholarship_opportunity"],
    ["What is the course withdrawal deadline?", undefined, "deadline"],
    ["Find reliable study spaces near university", undefined, "general_student_research"],
  ] as const)("classifies %s", (query, course, intent) => {
    expect(classifyStudentIntent(query, course)).toBe(intent);
  });

  it("answers a course concept extractively and admits a missing worked example", async () => {
    const provider = gateway();
    const service = new TinyFishResearchService({ gateway: provider, now: () => FIXED_NOW });
    const result = await service.research({
      query: "Explain conditional probability with a worked example",
      course: "STAT 210",
      mode: "answer",
    });

    expect(provider.search).toHaveBeenCalledTimes(2);
    expect(provider.search).toHaveBeenNthCalledWith(1, expect.stringContaining("worked example open textbook lecture notes practice problem"));
    expect(provider.search).toHaveBeenNthCalledWith(2, expect.stringContaining("OpenStax"));
    expect(result.body).toMatch(/^Conditional probability restricts/);
    expect(result.body).toContain("Public pages didn’t include a numeric classroom problem");
    expect(result.body).not.toContain("Uncertainty:");
    expect(result.body).not.toContain("Takeaway:");
    expect(result.body).not.toMatch(/\[\d\]/);
    expect(result.body).not.toContain(result.sources[0]!.url);
    expect(result.body.length).toBeLessThanOrEqual(900);
  });

  it("prioritizes an official campus-hours page and gives the hours first", async () => {
    const provider = gateway({
      search: vi.fn(async () => [
        { title: "Student blog library tips", url: "https://student-blog.example/library", snippet: "Unofficial tips." },
        { title: "Main Library Hours", url: "https://www.uaeu.ac.ae/library/hours", snippet: "Official hours." },
      ]),
      fetch: vi.fn(async (urls: string[]) => urls.map((url) => url.includes("uaeu") ? {
        title: "Main Library Hours",
        url,
        text: "The Main Library is open Monday through Thursday from 8:00 AM to 8:00 PM. Friday hours are posted separately for holidays.",
      } : {
        title: "Student blog library tips",
        url,
        text: "This student blog contains general suggestions but does not publish official opening hours.",
      })),
    });
    const service = new TinyFishResearchService({ gateway: provider, now: () => FIXED_NOW });
    const result = await service.research({ query: "What are the campus library hours?", mode: "answer" });

    expect(provider.search).toHaveBeenCalledWith(expect.stringContaining("official university campus service hours event"));
    expect(vi.mocked(provider.fetch).mock.calls[0]?.[0][0]).toContain("uaeu.ac.ae");
    expect(result.body).toMatch(/^The Main Library is open/);
    expect(result.body).toContain("Main Library Hours");
    expect(result.body.length).toBeLessThanOrEqual(900);
  });

  it("answers a scholarship request from official eligibility and deadline evidence", async () => {
    const provider = gateway({
      search: vi.fn(async () => [{
        title: "Undergraduate Scholarship Eligibility",
        url: "https://scholarships.gov.ae/undergraduate",
        snippet: "Official scholarship guidance.",
      }]),
      fetch: vi.fn(async () => [{
        title: "Undergraduate Scholarship Eligibility",
        url: "https://scholarships.gov.ae/undergraduate",
        text: "Eligible undergraduate students with a cumulative GPA of 3.5 or higher may apply. The application deadline is 15 October 2026.",
      }]),
    });
    const service = new TinyFishResearchService({ gateway: provider, now: () => FIXED_NOW });
    const result = await service.research({
      query: "Am I eligible for the undergraduate scholarship and what is the deadline?",
      mode: "answer",
    });

    expect(provider.search).toHaveBeenCalledWith(expect.stringContaining("official scholarship opportunity eligibility deadline"));
    expect(result.body).toContain("GPA of 3.5 or higher");
    expect(result.body).toContain("15 October 2026");
    expect(result.body.length).toBeLessThanOrEqual(900);
  });

  it("answers a textbook request from publisher edition and ISBN evidence", async () => {
    const provider = gateway({
      search: vi.fn(async () => [
        { title: "Used book discussion", url: "https://forum.example/books", snippet: "Unverified." },
        { title: "Probability and Statistics — Third Edition", url: "https://www.pearson.com/books/probability", snippet: "Publisher page." },
      ]),
      fetch: vi.fn(async (urls: string[]) => urls.map((url) => url.includes("pearson") ? {
        title: "Probability and Statistics — Third Edition",
        url,
        text: "Probability and Statistics, Third Edition, has ISBN 978-1-23456-789-0. The publisher lists print and digital formats.",
      } : {
        title: "Used book discussion",
        url,
        text: "Forum participants discuss several books without confirming an edition or ISBN.",
      })),
    });
    const service = new TinyFishResearchService({ gateway: provider, now: () => FIXED_NOW });
    const result = await service.research({
      query: "Find the correct textbook edition and ISBN",
      course: "STAT 210",
      mode: "answer",
    });

    expect(provider.search).toHaveBeenCalledWith(expect.stringContaining("official publisher ISBN edition university library legitimate access"));
    expect(vi.mocked(provider.fetch).mock.calls[0]?.[0][0]).toContain("pearson.com");
    expect(result.body).toContain("Third Edition");
    expect(result.body).toContain("978-1-23456-789-0");
    expect(result.body.length).toBeLessThanOrEqual(900);
  });

  it("hard-limits even very large evidence to 900 characters", async () => {
    const longSentence = `Scholarship eligibility details ${"verified evidence ".repeat(120)}.`;
    const provider = gateway({
      search: vi.fn(async () => [
        { title: "A very long official scholarship programme title that should be compacted for iMessage", url: "https://funding.example.edu/program", snippet: "Official." },
      ]),
      fetch: vi.fn(async () => [{
        title: "A very long official scholarship programme title that should be compacted for iMessage",
        url: "https://funding.example.edu/program",
        text: longSentence,
      }]),
    });
    const service = new TinyFishResearchService({ gateway: provider, now: () => FIXED_NOW });
    const result = await service.research({ query: "scholarship eligibility", mode: "answer" });
    expect(result.body.length).toBeLessThanOrEqual(900);
    expect(result.body).toContain("Reply SOURCES for links");
    expect(result.body).not.toMatch(/\b[A-Za-z]…/);
    expect(result.body).not.toContain("https://funding.example.edu/program");
  });

  it("builds different search augmentations for different student intents", () => {
    expect(buildSearchQuery("library hours", undefined, [], "campus_service_event")).toContain("campus service hours");
    expect(buildSearchQuery("book", "STAT 210", [], "textbook_resource")).toContain("publisher ISBN edition");
  });
});

describe("optional answer composition", () => {
  it("formats a good composition concisely without a URL or long source excerpt", async () => {
    const composer: AnswerComposer = {
      compose: vi.fn(async () => ({
        attempted: true,
        answer: {
          explanation: "Conditional probability asks how likely an event is once another event is known to have happened.",
          workedExample: "In the verified card example, matching joint outcomes are divided by all outcomes in the known event.",
          takeaway: "Restrict the sample space before dividing.",
          sourceIds: ["S1"],
          supportQuotes: [
            { claim: "explanation" as const, sourceId: "S1", quote: "Conditional probability restricts the sample space." },
            { claim: "workedExample" as const, sourceId: "S1", quote: "For example, matching joint outcomes are divided by all outcomes in the known event." },
            { claim: "takeaway" as const, sourceId: "S1", quote: "Restrict the sample space before dividing." },
          ],
        },
      })),
    };
    const service = new TinyFishResearchService({
      gateway: gateway({
        fetch: vi.fn(async () => [{
          title: "Probability course notes",
          url: "https://math.example.edu/notes",
          text: "Conditional probability restricts the sample space. For example, matching joint outcomes are divided by all outcomes in the known event. Restrict the sample space before dividing.",
        }]),
      }),
      composer,
      now: () => FIXED_NOW,
    });
    const result = await service.research({
      query: "Explain conditional probability with a worked example",
      course: "STAT 210",
      mode: "answer",
    });

    expect(composer.compose).toHaveBeenCalledOnce();
    expect(composer.compose).toHaveBeenCalledWith(expect.objectContaining({
      query: "Explain conditional probability with a worked example",
      intent: "course_concept",
      sources: [expect.objectContaining({ endpoint: "fetch" })],
    }));
    expect(composer.compose).not.toHaveBeenCalledWith(expect.objectContaining({ course: "STAT 210" }));
    expect(result.endpoints).toEqual(["search", "fetch"]);
    expect(result.body).toMatch(/^In the verified card example/);
    expect(result.body).toContain("Conditional probability asks");
    expect(result.body).toContain("Restrict the sample space before dividing.");
    expect(result.body).not.toContain("Worked example:");
    expect(result.body).not.toContain("Takeaway:");
    expect(result.body).not.toMatch(/\[\d\]/);
    expect(result.body).not.toContain("Uncertainty:");
    expect(result.body).toContain("Reply SOURCES for links");
    expect(result.body).not.toContain("https://math.example.edu/notes");
    expect(result.body).not.toContain("normalizes the remaining outcomes");
    expect(result.body.length).toBeLessThanOrEqual(900);
  });

  it("falls back to the extractive answer after one composer failure", async () => {
    const composer: AnswerComposer = {
      compose: vi.fn(async () => { throw new Error("malformed provider response"); }),
    };
    const service = new TinyFishResearchService({ gateway: gateway(), composer, now: () => FIXED_NOW });
    const result = await service.research({ query: "Explain conditional probability", mode: "answer" });

    expect(composer.compose).toHaveBeenCalledOnce();
    expect(result.endpoints).toEqual(["search", "fetch"]);
    expect(result.body).toMatch(/^Conditional probability restricts/);
    expect(result.body).not.toContain("https://math.example.edu/notes");
    expect(result.body.length).toBeLessThanOrEqual(900);
  });

  it("falls back to the extractive answer when composition returns no validated answer", async () => {
    const composer: AnswerComposer = {
      compose: vi.fn(async () => ({ attempted: true })),
    };
    const service = new TinyFishResearchService({ gateway: gateway(), composer, now: () => FIXED_NOW });
    const result = await service.research({ query: "Explain conditional probability", mode: "answer" });

    expect(composer.compose).toHaveBeenCalledOnce();
    expect(result.endpoints).toEqual(["search", "fetch"]);
    expect(result.body).toMatch(/^Conditional probability restricts/);
    expect(result.body).toContain("Reply SOURCES for links");
    expect(result.body.length).toBeLessThanOrEqual(900);
  });

  it("retries once for a worked example and prefers the page that has one", async () => {
    const search = vi.fn()
      .mockResolvedValueOnce([{
        title: "Glossary",
        url: "https://math.example.edu/glossary",
        snippet: "Definition only.",
      }])
      .mockResolvedValueOnce([{
        title: "OpenStax Introductory Statistics",
        url: "https://openstax.org/books/introductory-statistics",
        snippet: "Worked example.",
      }]);
    const fetch = vi.fn(async (urls: string[]) => urls.map((url) => url.includes("openstax") ? {
      title: "OpenStax Introductory Statistics",
      url,
      text: "Conditional probability is the probability of event B given that event A has occurred. For example, if a card is red, the chance it is a heart is one of the two red suits.",
    } : {
      title: "Glossary",
      url,
      text: "Conditional probability is the likelihood of an event occurring given that another event has already taken place.",
    }));
    const service = new TinyFishResearchService({
      gateway: { search, fetch },
      now: () => FIXED_NOW,
    });
    const result = await service.research({
      query: "Conditional probability in statistics — Give me an explainable example?",
      mode: "answer",
    });

    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[1]?.[0]).toMatch(/conditional probability/i);
    expect(search.mock.calls[1]?.[0]).toContain("OpenStax");
    expect(result.body).toMatch(/For example, if a card is red/);
    expect(result.body).not.toContain("Takeaway:");
    expect(result.body).not.toMatch(/\[\d\]/);
    expect(result.body).not.toContain("Uncertainty:");
    expect(result.body).not.toMatch(/\b0\.\d/);
  });

  it("answers with the numeric classroom problem instead of a qualitative story", async () => {
    const provider = gateway({
      search: vi.fn(async () => [
        { title: "Lesson | Study.com", url: "https://study.com/learn/lesson/x.html", snippet: "SEO lesson." },
        { title: "Conditional Probability", url: "https://www.probabilitycourse.com/chapter1/1_4_0_conditional_probability.php", snippet: "Open course." },
      ]),
      fetch: vi.fn(async (urls: string[]) => urls.map((url) => url.includes("probabilitycourse") ? {
        title: "Conditional Probability",
        url,
        text: "Conditional probability updates a chance after extra information. For example, suppose that in a certain city, 23 percent of the days are rainy. Thus P(R)=0.23. If you also know the day is cloudy, you compute P(R|C).",
      } : {
        title: "Lesson | Study.com",
        url,
        text: "For example, the first event is a person being a smoker and the second event is the probability of having lung cancer.",
      })),
    });
    const service = new TinyFishResearchService({ gateway: provider, now: () => FIXED_NOW });
    const result = await service.research({
      query: "Conditional probability in statistics — Give me an explainable example?",
      mode: "answer",
    });

    expect(vi.mocked(provider.search).mock.calls[0]?.[0]).not.toMatch(/study\.com/i);
    expect(result.body).toMatch(/0\.23|23 percent/);
    expect(result.body).not.toMatch(/smoker/i);
    expect(result.body).not.toMatch(/Study\.com/i);
    expect(result.body).toContain("Pishro-Nik");
    expect(result.sources.every((source) => !source.url.includes("study.com"))).toBe(true);
    expect(result.sources.every((source) => !/untitled/i.test(source.title))).toBe(true);
  });

  it("walks the sourced formula without inventing numbers when no example is published", async () => {
    const provider = gateway({
      search: vi.fn(async () => [{
        title: "OpenStax Introductory Statistics",
        url: "https://openstax.org/books/introductory-statistics",
        snippet: "Definition.",
      }]),
      fetch: vi.fn(async () => [{
        title: "OpenStax Introductory Statistics",
        url: "https://openstax.org/books/introductory-statistics",
        text: "The conditional probability of B given A is written P(B|A) = P(A and B) / P(A), using only the events named A and B.",
      }]),
    });
    const service = new TinyFishResearchService({ gateway: provider, now: () => FIXED_NOW });
    const result = await service.research({
      query: "Explain conditional probability with a worked example",
      mode: "answer",
    });

    expect(provider.search).toHaveBeenCalledTimes(2);
    expect(result.body).toContain("P(B|A)");
    expect(result.body).toContain("Public pages didn’t include a numeric classroom problem");
    expect(result.body).not.toContain("Uncertainty:");
    expect(result.body).not.toContain("Takeaway:");
    expect(result.body).not.toMatch(/\[\d\]/);
    expect(result.body).not.toMatch(/\b0\.\d+\b/);
  });

  it("refuses an unrelated page instead of teaching it", async () => {
    const attrition = {
      title: "Predicting and Mitigating Freshmen Student Attrition",
      url: "https://ml.example.edu/attrition",
      snippet: "Machine learning.",
      text: "A hybrid machine learning framework predicts freshman attrition and designs individualized interventions from group-level interpretations.",
    };
    const search = vi.fn(async () => [{ title: attrition.title, url: attrition.url, snippet: attrition.snippet }]);
    const fetch = vi.fn(async () => [{ title: attrition.title, url: attrition.url, text: attrition.text }]);
    const composer: AnswerComposer = {
      compose: vi.fn(async () => ({
        attempted: true,
        answer: {
          explanation: "The provided text discusses a hybrid machine learning framework designed to predict freshman attrition.",
          takeaway: "Group-level interpretations can design individual interventions.",
          sourceIds: ["S1"],
          supportQuotes: [],
        },
      })),
    };
    const service = new TinyFishResearchService({
      gateway: { search, fetch },
      composer,
      now: () => FIXED_NOW,
    });
    const result = await service.research({
      query: "Conditional probability in statistics — Give me an explainable example?",
      mode: "answer",
    });

    expect(search).toHaveBeenCalledTimes(2);
    expect(result.body).toMatch(/don’t match the question/);
    expect(result.body).not.toMatch(/hybrid machine learning/i);
    expect(result.body).not.toContain("Takeaway:");
    expect(result.body).not.toMatch(/\[\d\]/);
  });
});

describe("BoundedAgentEscalator", () => {
  it("is disabled by default and never calls the paid runner", async () => {
    const runner: AgentRunner = { run: vi.fn() };
    const agent = new BoundedAgentEscalator(runner);
    await expect(agent.extract({
      url: "https://catalog.example.edu",
      query: "courses",
    })).resolves.toBeUndefined();
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("clamps paid runs and ignores a cross-origin URL returned by the page", async () => {
    const runner: AgentRunner = {
      run: vi.fn(async () => ({
        status: "COMPLETED" as const,
        run_id: "run-1",
        result: {
          title: "Catalogue",
          excerpt: "Official current catalogue details extracted from the interactive page.",
          url: "https://evil.example/redirect",
        },
        error: null,
        num_of_steps: 3,
        started_at: FIXED_NOW.toISOString(),
        finished_at: FIXED_NOW.toISOString(),
      })),
    };
    const agent = new BoundedAgentEscalator(runner, {
      enabled: true,
      maxSteps: 999,
      maxDurationSeconds: 999,
    });
    const result = await agent.extract({
      url: "https://catalog.example.edu/course",
      query: "prerequisites",
    });

    expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({
      maxSteps: 12,
      maxDurationSeconds: 90,
    }));
    expect(result?.url).toBe("https://catalog.example.edu/course");
  });
});
