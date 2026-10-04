import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  FIRSTROLE_SHORTLIST_LABEL,
  FIRSTROLE_URL,
  MAX_ROLE_LISTINGS,
  MAX_ROLES_AGENT_CALLS,
  MAX_ROLES_LISTING_FETCHES,
  MAX_ROLES_SEARCH_QUERIES,
  ROLES_AGENT_GOAL,
  ROLES_AGENT_GOAL_ID,
  buildRolesSearchQueries,
  createRolesFinder,
  extractRoleListing,
  findRoles,
  formatRolesReply,
  isJobDetailUrl,
  listingAvailability,
  looksLikeJsPortal,
  namedFirstRoleLink,
  roleFromQuery,
  type RoleListing,
  type RolesTinyFish,
} from "./roles.js";
import type { LodgeAgentPage, LodgeFetchedPage, LodgeSearchHit } from "./agent.js";

const NOW = new Date("2026-10-04T08:00:00.000Z");
const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "roles.ts"), "utf8");

const NORTH_QUAY = "https://careers.northquay.example/jobs/summer-internship-dubai";
const ARCHIVES = "https://jobs.municipalarchives.example/positions/reading-room-assistant";
const HARBOR = "https://harborpress.example/jobs/editorial-intern";
const HARBOR_PORTAL = "https://jobs.greenhouse.io/harborpress";
const HARBOR_DETAIL = "https://jobs.greenhouse.io/harborpress/jobs/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CLOSED = "https://careers.oldco.example/jobs/closed-intern";
const SENIOR = "https://careers.oldco.example/jobs/senior-director";
const INDEED = "https://www.indeed.com/jobs/internship-dubai";
const GOOGLE_LOGIN = "https://accounts.google.com/signin";
const BLOG = "https://careers.northquay.example/jobs/made-up";
const PRIVATE = "https://127.0.0.1/jobs/secret-intern";
const FOURTH = "https://careers.fourth.example/jobs/intern-dubai";

const PAGES: Record<string, LodgeFetchedPage> = {
  [NORTH_QUAY]: {
    title: "Summer internship at North Quay Studio",
    url: NORTH_QUAY,
    text: [
      "# Summer internship",
      "Company: North Quay Studio",
      "Location: Dubai",
      "Posted 1 October 2026",
      "Apply now",
      "Applications are still open.",
    ].join("\n"),
  },
  [ARCHIVES]: {
    title: "Reading-room assistant",
    url: ARCHIVES,
    text: [
      "# Reading-room assistant",
      "Company: Municipal Archives",
      "Location: Dubai",
      "Internship. Apply now.",
    ].join("\n"),
  },
  [HARBOR]: {
    title: "Editorial intern",
    url: HARBOR,
    text: ["# Editorial intern", "Company: Harbor Press", "Location: Dubai", "Internship posting."].join("\n"),
  },
  [HARBOR_PORTAL]: {
    title: "Harbor Press careers",
    url: HARBOR_PORTAL,
    text: "Enable JavaScript to view openings.",
  },
  [HARBOR_DETAIL]: {
    title: "Editorial intern at Harbor Press",
    url: HARBOR_DETAIL,
    text: ["# Editorial intern", "Company: Harbor Press", "Location: Dubai", "Internship. Apply now."].join("\n"),
  },
  [CLOSED]: {
    title: "Closed intern",
    url: CLOSED,
    text: [
      "This job has been filled.",
      "# Closed intern",
      "Company: Old Co",
      "Location: Dubai",
      "Apply now",
    ].join("\n"),
  },
  [SENIOR]: {
    title: "Senior Director",
    url: SENIOR,
    text: "# Senior Director\nCompany: Old Co\nLocation: Dubai\nApply now",
  },
  [BLOG]: {
    title: "Careers blog",
    url: BLOG,
    text: "Welcome to our blog. This article talks about internships in general and names no employer and no opening. It is not a job listing.",
  },
  [FOURTH]: {
    title: "Intern",
    url: FOURTH,
    text: "# Research intern\nCompany: Fourth Light\nLocation: Dubai\nInternship. Apply now.",
  },
};

function hit(url: string, title: string, snippet = "internship Dubai"): LodgeSearchHit {
  return { title, url, snippet };
}

function tinyfish(options: {
  hits?: LodgeSearchHit[] | ((query: string) => LodgeSearchHit[]);
  pages?: Record<string, LodgeFetchedPage>;
  agent?: LodgeAgentPage | ((input: { url: string; goal: string; goalId: string }) => LodgeAgentPage);
  searchError?: Error;
  fetchErrors?: Record<string, Error>;
  agentError?: Error;
}): RolesTinyFish & {
  search: ReturnType<typeof vi.fn<RolesTinyFish["search"]>>;
  fetch: ReturnType<typeof vi.fn<RolesTinyFish["fetch"]>>;
  agent: ReturnType<typeof vi.fn<RolesTinyFish["agent"]>>;
} {
  const pages = options.pages ?? PAGES;
  const search = vi.fn<RolesTinyFish["search"]>(async (query) => {
    if (options.searchError) throw options.searchError;
    return typeof options.hits === "function" ? options.hits(query) : (options.hits ?? []);
  });
  const fetchPage = vi.fn<RolesTinyFish["fetch"]>(async (url) => {
    if (options.fetchErrors?.[url]) throw options.fetchErrors[url];
    const page = pages[url];
    if (!page) throw new Error(`unexpected fetch ${url}`);
    return page;
  });
  const agentRun = vi.fn<RolesTinyFish["agent"]>(async (input) => {
    if (options.agentError) throw options.agentError;
    if (typeof options.agent === "function") return options.agent(input);
    if (options.agent) return options.agent;
    throw new Error("unexpected agent");
  });
  return { search, fetch: fetchPage, agent: agentRun };
}

function listing(partial: Partial<RoleListing> & Pick<RoleListing, "company" | "title" | "url">): RoleListing {
  const availability = partial.availability ?? "unverified";
  return {
    matchReason: "internship, Dubai",
    ...partial,
    availability,
    stillOpen: partial.stillOpen ?? availability,
  };
}

describe("roles search queries", () => {
  it("builds at most three Search queries from a city and internships ask", () => {
    const queries = buildRolesSearchQueries("any internships in Dubai?", "Dubai", NOW);
    expect(roleFromQuery("any internships in Dubai?", "Dubai")).toBe("internships");
    expect(queries.length).toBeLessThanOrEqual(MAX_ROLES_SEARCH_QUERIES);
    expect(queries).toHaveLength(3);
    expect(queries[0]).toContain("internships");
    expect(queries[0]).toContain('"Dubai"');
    expect(queries[0]).toContain("careers");
    expect(queries[2]).toContain("2026");
    expect(queries[2]).toContain("UAE");
  });

  it("refuses an empty role or city instead of inventing one", () => {
    expect(buildRolesSearchQueries("???", "Dubai", NOW)).toEqual([]);
    expect(buildRolesSearchQueries("internships", "x", NOW)).toEqual([]);
    expect(roleFromQuery("??", "Dubai")).toBeUndefined();
  });
});

describe("listing extraction", () => {
  it("reads company, title, open/closed/unverified, and an observed match reason", () => {
    expect(extractRoleListing(PAGES[NORTH_QUAY]!, { city: "Dubai", now: NOW })).toEqual({
      company: "North Quay Studio",
      title: "Summer internship",
      url: NORTH_QUAY,
      availability: "open",
      stillOpen: "open",
      matchReason: "internship, Dubai, posted this week",
    });
    expect(extractRoleListing(PAGES[HARBOR]!, { city: "Dubai", now: NOW })).toMatchObject({
      company: "Harbor Press",
      title: "Editorial intern",
      availability: "unverified",
      stillOpen: "unverified",
      matchReason: "internship, Dubai",
    });
    expect(extractRoleListing(PAGES[CLOSED]!, { city: "Dubai", now: NOW })?.availability).toBe("closed");
    expect(listingAvailability(PAGES[NORTH_QUAY]!.text, NOW)).toBe("open");
    expect(listingAvailability("Sign in to continue", NOW)).toBe("unverified");
  });

  it("never invents a posting when company or title is missing, and skips senior roles", () => {
    expect(extractRoleListing(PAGES[BLOG]!, { city: "Dubai", now: NOW })).toBeUndefined();
    expect(
      extractRoleListing(
        { title: "Careers", url: NORTH_QUAY, text: "Join our team in Dubai. Apply now." },
        { city: "Dubai", now: NOW },
      ),
    ).toBeUndefined();
    expect(extractRoleListing(PAGES[SENIOR]!, { city: "Dubai", now: NOW })).toBeUndefined();
    expect(extractRoleListing(PAGES[HARBOR]!, { city: "London", now: NOW })).toBeUndefined();
  });

  it("treats thin JS shells as portals and recognizes job-detail URLs", () => {
    expect(looksLikeJsPortal(PAGES[HARBOR_PORTAL]!)).toBe(true);
    expect(looksLikeJsPortal(PAGES[NORTH_QUAY]!)).toBe(false);
    expect(isJobDetailUrl(NORTH_QUAY)).toBe(true);
    expect(isJobDetailUrl(HARBOR_PORTAL)).toBe(false);
    expect(isJobDetailUrl(HARBOR_DETAIL)).toBe(true);
  });
});

describe("FirstRole named link", () => {
  it("ends every reply with the named FirstRole shortlist link", () => {
    const filled = formatRolesReply([
      listing({
        company: "North Quay Studio",
        title: "Summer internship",
        url: NORTH_QUAY,
        availability: "open",
        matchReason: "internship, Dubai, posted this week",
      }),
    ]);
    const unverified = formatRolesReply([
      listing({
        company: "Harbor Press",
        title: "Editorial intern",
        url: HARBOR,
        availability: "unverified",
      }),
    ]);
    const empty = formatRolesReply([]);
    for (const reply of [filled, unverified, empty]) {
      expect(reply).toContain(FIRSTROLE_SHORTLIST_LABEL);
      expect(reply).toContain(FIRSTROLE_URL);
      expect(reply.trim().endsWith(FIRSTROLE_URL)).toBe(true);
    }
    expect(empty).toMatch(/have not guessed/i);
    expect(filled).toContain("open ·");
    expect(filled).not.toMatch(/\bverified\b/i);
    expect(unverified).toMatch(/\bunverified\b/);
    expect(unverified).not.toMatch(/(?<!un)verified/i);
    expect(namedFirstRoleLink()).toEqual({
      label: FIRSTROLE_SHORTLIST_LABEL,
      url: "https://firstrole.hamdanesmail12-7a9.workers.dev",
    });
  });
});

describe("findRoles", () => {
  it("returns 1–3 Fetch listings with company, title, availability, and match reason", async () => {
    const port = tinyfish({
      hits: [
        hit(NORTH_QUAY, "Summer internship Dubai"),
        hit(ARCHIVES, "Reading-room assistant internship Dubai"),
        hit(HARBOR, "Editorial intern Dubai"),
      ],
    });
    const result = await findRoles({
      query: "internships",
      city: "Dubai",
      tinyfish: port,
      now: () => NOW,
    });
    expect(result.searches).toBeLessThanOrEqual(MAX_ROLES_SEARCH_QUERIES);
    expect(result.fetches).toBeLessThanOrEqual(MAX_ROLES_LISTING_FETCHES);
    expect(result.agentCalls).toBe(0);
    expect(port.agent).not.toHaveBeenCalled();
    expect(result.listings).toHaveLength(3);
    expect(result.listings.map((item) => item.company).sort()).toEqual([
      "Harbor Press",
      "Municipal Archives",
      "North Quay Studio",
    ]);
    expect(result.listings.every((item) => ["open", "closed", "unverified"].includes(item.availability))).toBe(true);
    expect(result.listings.find((item) => item.company === "Harbor Press")?.availability).toBe("unverified");
    expect(result.listings.find((item) => item.company === "North Quay Studio")).toMatchObject({
      availability: "open",
      stillOpen: "open",
      matchReason: "internship, Dubai, posted this week",
    });
    expect(result.reply).toContain("North Quay Studio — Summer internship");
    expect(result.reply).toContain(FIRSTROLE_SHORTLIST_LABEL);
    expect(result.reply).toContain(FIRSTROLE_URL);
    expect(result.firstRole.url).toBe(FIRSTROLE_URL);
  });

  it("caps Search at three queries and skips the third when three job details already exist", async () => {
    const port = tinyfish({
      hits: (query) => {
        if (query.includes("careers")) {
          return [hit(NORTH_QUAY, "Summer internship Dubai"), hit(ARCHIVES, "Reading-room assistant Dubai")];
        }
        if (query.includes("jobs")) {
          return [hit(HARBOR, "Editorial intern Dubai")];
        }
        throw new Error(`unexpected extra search: ${query}`);
      },
    });
    const result = await findRoles({
      query: "internships",
      city: "Dubai",
      tinyfish: port,
      now: () => NOW,
    });
    expect(port.search).toHaveBeenCalledTimes(2);
    expect(result.searches).toBe(2);
    expect(result.listings).toHaveLength(3);
  });

  it("opens at most one JS careers portal read-only, then Fetch-verifies still-open", async () => {
    const port = tinyfish({
      hits: [hit(NORTH_QUAY, "Summer internship Dubai"), hit(HARBOR_PORTAL, "Harbor Press careers Dubai internship")],
      agent: {
        title: "Editorial intern",
        url: HARBOR_DETAIL,
        excerpt: "Company: Harbor Press\nEditorial intern. Location: Dubai. Apply now.",
        stillOpen: "open",
      },
    });
    const result = await findRoles({
      query: "internships",
      city: "Dubai",
      tinyfish: port,
      now: () => NOW,
    });
    expect(result.agentCalls).toBe(1);
    expect(result.agentCalls).toBeLessThanOrEqual(MAX_ROLES_AGENT_CALLS);
    expect(port.agent).toHaveBeenCalledTimes(1);
    expect(port.agent).toHaveBeenCalledWith({
      url: HARBOR_PORTAL,
      goal: ROLES_AGENT_GOAL,
      goalId: ROLES_AGENT_GOAL_ID,
    });
    expect(ROLES_AGENT_GOAL).toMatch(/Never apply/i);
    expect(ROLES_AGENT_GOAL).toMatch(/Do not sign in, type into fields, submit a form, apply/i);
    expect(port.fetch.mock.calls.map((call) => call[0])).toContain(HARBOR_DETAIL);
    expect(result.verifiedUrl).toBe(HARBOR_DETAIL);
    expect(result.listings.some((item) => item.url === HARBOR_DETAIL && item.availability === "open")).toBe(true);
    expect(result.listings.some((item) => item.company === "North Quay Studio")).toBe(true);
  });

  it("does not label Agent still-open as verified when Fetch-verify cannot confirm it", async () => {
    const port = tinyfish({
      hits: [hit(HARBOR_PORTAL, "Harbor Press careers internship Dubai")],
      pages: {
        [HARBOR_PORTAL]: PAGES[HARBOR_PORTAL]!,
        [HARBOR_DETAIL]: {
          title: "Harbor Press",
          url: HARBOR_DETAIL,
          text: "Enable JavaScript to view openings.",
        },
      },
      agent: {
        title: "Editorial intern",
        url: HARBOR_DETAIL,
        excerpt: "Company: Harbor Press\nEditorial intern. Location: Dubai.",
        stillOpen: "open",
      },
    });
    const result = await findRoles({
      query: "internships",
      city: "Dubai",
      tinyfish: port,
      now: () => NOW,
    });
    expect(port.agent).toHaveBeenCalledTimes(1);
    expect(result.listings).toEqual([
      expect.objectContaining({
        company: "Harbor Press",
        title: "Editorial intern",
        url: HARBOR_DETAIL,
        availability: "unverified",
        stillOpen: "unverified",
      }),
    ]);
    expect(result.reply).toContain("unverified");
    expect(result.reply).not.toMatch(/(?<!un)verified/i);
    expect(result.namedFailures).toContain("fetch_verify_unreadable");
  });

  it("never turns a Search snippet or aggregator card into a listing", async () => {
    const port = tinyfish({
      hits: [
        hit(BLOG, "Made-up internship at FakeCorp", "Paid internship in Dubai, apply today"),
        hit(INDEED, "Internship Dubai", "Hiring internships in Dubai"),
        hit(GOOGLE_LOGIN, "Sign in", "Google login"),
        hit(PRIVATE, "Secret intern", "internship Dubai"),
      ],
    });
    const result = await findRoles({
      query: "internships",
      city: "Dubai",
      tinyfish: port,
      now: () => NOW,
    });
    expect(result.listings).toEqual([]);
    expect(port.fetch).not.toHaveBeenCalledWith(INDEED);
    expect(port.fetch).not.toHaveBeenCalledWith(GOOGLE_LOGIN);
    expect(port.fetch).not.toHaveBeenCalledWith(PRIVATE);
    expect(port.agent).not.toHaveBeenCalled();
    expect(result.reply).toContain(FIRSTROLE_SHORTLIST_LABEL);
    expect(result.reply).toContain(FIRSTROLE_URL);
    expect(result.reply).toMatch(/have not guessed/i);
  });

  it("returns at most three listings and will not spend Agent when the desk is already full", async () => {
    const port = tinyfish({
      hits: [
        hit(NORTH_QUAY, "Summer internship Dubai"),
        hit(ARCHIVES, "Reading-room assistant Dubai"),
        hit(FOURTH, "Research intern Dubai"),
        hit(HARBOR_PORTAL, "Harbor Press careers internship Dubai"),
      ],
    });
    const result = await findRoles({
      query: "internships",
      city: "Dubai",
      tinyfish: port,
      now: () => NOW,
    });
    expect(result.listings.length).toBeLessThanOrEqual(MAX_ROLE_LISTINGS);
    expect(result.listings).toHaveLength(3);
    expect(result.listings.every((item) => item.availability === "open")).toBe(true);
    expect(port.agent).not.toHaveBeenCalled();
    expect(result.agentCalls).toBe(0);
  });

  it("names TinyFish failures instead of inventing openings", async () => {
    const port = tinyfish({
      hits: [hit(NORTH_QUAY, "Summer internship Dubai")],
      searchError: new Error("TinyFish Search timed out"),
    });
    const result = await findRoles({
      query: "internships",
      city: "Dubai",
      tinyfish: port,
      now: () => NOW,
    });
    expect(result.listings).toEqual([]);
    expect(result.namedFailures).toContain("tinyfish_timeout");
    expect(result.reply).toMatch(/timed out/i);
    expect(result.reply).toContain(FIRSTROLE_URL);
  });

  it("marks a listing closed when Fetch-verify says it was removed", async () => {
    const port = tinyfish({
      hits: [hit(HARBOR_PORTAL, "Harbor Press careers internship Dubai")],
      fetchErrors: {
        [HARBOR_DETAIL]: new Error("LISTING_REMOVED: no longer available"),
      },
      agent: {
        title: "Editorial intern",
        url: HARBOR_DETAIL,
        excerpt: "Company: Harbor Press\nEditorial intern. Location: Dubai.",
      },
    });
    const result = await findRoles({
      query: "internships",
      city: "Dubai",
      tinyfish: port,
      now: () => NOW,
    });
    expect(result.listings).toEqual([
      expect.objectContaining({
        company: "Harbor Press",
        title: "Editorial intern",
        availability: "closed",
        stillOpen: "closed",
        url: HARBOR_DETAIL,
      }),
    ]);
  });

  it("does not search when the city or query is unusable, and still links FirstRole", async () => {
    const port = tinyfish({ hits: [hit(NORTH_QUAY, "Summer internship")] });
    const missingCity = await findRoles({
      query: "internships",
      city: "",
      tinyfish: port,
      now: () => NOW,
    });
    const missingRole = await findRoles({
      query: "??",
      city: "Dubai",
      tinyfish: port,
      now: () => NOW,
    });
    expect(port.search).not.toHaveBeenCalled();
    expect(port.fetch).not.toHaveBeenCalled();
    expect(port.agent).not.toHaveBeenCalled();
    expect(missingCity.namedFailures).toContain("invalid_city");
    expect(missingRole.namedFailures).toContain("invalid_query");
    expect(missingCity.reply).toContain(FIRSTROLE_URL);
    expect(missingRole.reply).toContain(FIRSTROLE_SHORTLIST_LABEL);
  });

  it("exposes an injectable finder that returns listings only", async () => {
    const port = tinyfish({ hits: [hit(NORTH_QUAY, "Summer internship Dubai")] });
    const finder = createRolesFinder(port, () => NOW);
    const listings = await finder.findRoles({ query: "internships", city: "Dubai" });
    expect(listings).toEqual([
      expect.objectContaining({
        company: "North Quay Studio",
        title: "Summer internship",
        stillOpen: "open",
      }),
    ]);
  });
});

describe("hard rules in source", () => {
  it("does not port Firecrawl, Google login, or FirstRole's ledger, and never applies", () => {
    expect(SOURCE).not.toMatch(/firecrawl/i);
    expect(SOURCE).not.toMatch(/google login|accounts\.google|oauth/i);
    expect(SOURCE).not.toMatch(/\$10|ledger/i);
    expect(SOURCE).toContain(FIRSTROLE_URL);
    expect(SOURCE).toContain("Never apply");
    expect(ROLES_AGENT_GOAL).toMatch(/Never apply/i);
    expect(ROLES_AGENT_GOAL_ID).toBe("careers_portal");
    expect(MAX_ROLES_SEARCH_QUERIES).toBe(3);
    expect(MAX_ROLES_AGENT_CALLS).toBe(1);
    expect(MAX_ROLE_LISTINGS).toBe(3);
  });
});
