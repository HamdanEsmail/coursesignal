import {
  LODGE_AGENT_GOAL_TEMPLATES,
  guardPublicUrl,
  type LodgeAgentPage,
  type LodgeFetchedPage,
  type LodgeSearchHit,
  type LodgeTinyFishPort,
} from "./agent.js";

/**
 * Slim iMessage roles desk. Copies FirstRole's Search → Fetch → one read-only
 * Agent for a JS portal → Fetch-verify rules. Never apply. Never invent a
 * posting. Does not call FirstRole's API or Worker budget.
 */
export const FIRSTROLE_URL = "https://firstrole.hamdanesmail12-7a9.workers.dev";
export const FIRSTROLE_SHORTLIST_LABEL = "Full shortlist on FirstRole";
export const MAX_ROLES_SEARCH_QUERIES = 3;
export const MAX_ROLES_LISTING_FETCHES = 4;
export const MAX_ROLES_AGENT_CALLS = 1;
export const MAX_ROLE_LISTINGS = 3;
export const ROLES_AGENT_GOAL_ID = "careers_portal" as const;
export const ROLES_AGENT_GOAL = LODGE_AGENT_GOAL_TEMPLATES.careers_portal;

export const ROLE_AVAILABILITIES = ["open", "closed", "unverified"] as const;
export type RoleAvailability = (typeof ROLE_AVAILABILITIES)[number];

export type RoleListing = {
  company: string;
  title: string;
  url: string;
  availability: RoleAvailability;
  /** Alias of availability for the Lodge tools desk (`stillOpen` badge). */
  stillOpen: RoleAvailability;
  matchReason: string;
};

export type RolesTinyFish = Pick<LodgeTinyFishPort, "search" | "fetch" | "agent">;

export type RolesNamedFailure =
  | "invalid_query"
  | "invalid_city"
  | "tinyfish_timeout"
  | "tinyfish_failure"
  | "private_url"
  | "agent_unreadable"
  | "fetch_verify_unreadable";

export type FirstRoleLink = {
  label: typeof FIRSTROLE_SHORTLIST_LABEL;
  url: typeof FIRSTROLE_URL;
};

export type FindRolesInput = {
  query: string;
  city: string;
  tinyfish: RolesTinyFish;
  now?: () => Date;
};

export type FindRolesResult = {
  listings: RoleListing[];
  reply: string;
  queries: string[];
  searches: number;
  fetches: number;
  agentCalls: number;
  verifiedUrl?: string;
  namedFailures: RolesNamedFailure[];
  firstRole: FirstRoleLink;
};

export type RolesFinder = {
  findRoles(input: { query: string; city: string }): Promise<RoleListing[]>;
};

const CLOSED =
  /(?:this (?:job|position|vacancy|opening) (?:is|has been) (?:now )?(?:closed|filled|removed)|\b(?:job|position|vacancy|opening)\b[^.!?\n]{0,100}\bhas been (?:filled|closed|removed)\b|no longer (?:accepting applications|available)|job (?:has )?expired|position has been filled|\bthe page you (?:are|were) looking for (?:does not|doesn['’]t) exist\b|\b(?:page|job) (?:was )?not found\b)/i;
const EXPLICIT_OPEN =
  /\b(?:apply now|applications? are (?:still )?open|still open(?: for applications)?|submit (?:your )?application|currently accepting applications|apply for (?:this|the) (?:job|role|position))\b/i;
const APPLY_CONTROL = /(?:^|\n)\s*(?:\[)?(?:Apply|I['’]m interested)(?:\](?:\([^)]+\))?|\s|$)/im;
const LOGIN_WALL =
  /\b(?:sign in to continue|log in to (?:view|continue)|access denied|verify (?:that )?you are human|captcha|login required)\b/i;
const JS_SHELL =
  /\b(?:enable javascript|you need javascript|javascript (?:is )?required|loading jobs|please wait while (?:we|the) (?:load|jobs))\b/i;
const SENIOR =
  /\b(?:senior|sr\.?|principal|director|head of|vice president|staff engineer|lead engineer)\b/i;
const EARLY_CAREER =
  /(?:^|[^a-z0-9])(?:intern(?:ship)?s?|graduates?|entry[-_ ]?level|trainees?|apprentices?|juniors?|associates?|early[-_ ]?careers?)(?=$|[^a-z0-9])/i;
const AGGREGATORS = [
  "indeed.com",
  "bayt.com",
  "linkedin.com",
  "glassdoor.com",
  "naukrigulf.com",
  "gulftalent.com",
  "ziprecruiter.com",
  "foundit.com",
  "prosple.com",
  "bebee.com",
];
const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
const COUNTRY_AREAS: Record<string, string[]> = {
  ae: ["uae", "united arab emirates", "dubai", "abu dhabi", "sharjah"],
  sa: ["saudi arabia", "ksa", "riyadh", "jeddah"],
  qa: ["qatar", "doha"],
  us: ["united states", "usa", "new york", "boston", "san francisco"],
  gb: ["united kingdom", "uk", "london", "manchester"],
  ca: ["canada", "toronto", "vancouver"],
  in: ["india", "bengaluru", "bangalore", "mumbai"],
  au: ["australia", "sydney", "melbourne"],
};

export function namedFirstRoleLink(): FirstRoleLink {
  return { label: FIRSTROLE_SHORTLIST_LABEL, url: FIRSTROLE_URL };
}

export function createRolesFinder(tinyfish: RolesTinyFish, now?: () => Date): RolesFinder {
  return {
    async findRoles(input) {
      const result = await findRoles({ ...input, tinyfish, now });
      return result.listings;
    },
  };
}

export function roleFromQuery(query: string, city: string): string | undefined {
  const requestedCity = compact(city, 80);
  if (requestedCity.length < 2) return undefined;
  let role = compact(query, 200).replace(/[?!.,]/g, " ");
  role = role.replace(new RegExp(`\\b(?:in|near|around)\\s+${escapeRegExp(requestedCity)}\\b`, "gi"), " ");
  role = role.replace(
    /\b(?:any|some|looking for|find me|find|are there|is there|there any|please|hi|hey)\b/gi,
    " ",
  );
  role = compact(role, 100);
  if (role.length >= 2) return role;
  if (/\bintern/i.test(query)) return "internship";
  return undefined;
}

export function buildRolesSearchQueries(
  query: string,
  city: string,
  now: Date = new Date(),
): string[] {
  const role = roleFromQuery(query, city);
  const place = compact(city, 80);
  if (!role || place.length < 2) return [];
  const year = now.getUTCFullYear();
  const alt = alternativeCity(place);
  const typeTerm = /\bintern/i.test(role) ? "" : "internship";
  const queries = [
    compact(`${role} "${place}" ${typeTerm} careers`, 200),
    compact(`${role} "${place}" ${typeTerm} jobs`, 200),
    compact(`summer ${role} "${alt}" ${year}`, 200),
  ];
  return [...new Set(queries)].slice(0, MAX_ROLES_SEARCH_QUERIES);
}

export function isJobDetailUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const path = parsed.pathname;
  return (
    (/\/(?:jobs?|positions?|requisitions?)\/[^/?]+/i.test(path) &&
      !/\/(?:jobs?|positions?|requisitions?)\/(?:search|results|all|browse|apply)(?:\/|$)/i.test(path)) ||
    /[a-f\d]{8}-[a-f\d-]{15,}/i.test(path) ||
    /\/(?:j|job-detail|job-details)\/[^/?]+/i.test(path)
  );
}

export function listingAvailability(text: string, now: Date = new Date()): RoleAvailability {
  const body = text.slice(0, 60_000);
  if (CLOSED.test(body) || deadlinePassed(body, now)) return "closed";
  if (LOGIN_WALL.test(body.slice(0, 2_000))) return "unverified";
  if (EXPLICIT_OPEN.test(body) || APPLY_CONTROL.test(body)) return "open";
  return "unverified";
}

export function looksLikeJsPortal(page: LodgeFetchedPage): boolean {
  const text = compact(page.text, 8_000);
  if (LOGIN_WALL.test(page.text.slice(0, 2_000))) return false;
  if (JS_SHELL.test(page.text)) return true;
  return text.length < 40 && !labelledField(page.text, "Company|Employer|Hiring organization");
}

export function extractRoleListing(
  page: LodgeFetchedPage,
  context: { city: string; now?: Date },
): RoleListing | undefined {
  const url = publicListingUrl(page.finalUrl || page.url);
  if (!url) return undefined;
  const now = context.now ?? new Date();
  const content = page.text.slice(0, 60_000);
  const title = listingTitle(page, content);
  const company = listingCompany(page, content, title ?? "");
  if (!title || !company) return undefined;
  if (SENIOR.test(title)) return undefined;
  const labelledLocation = labelledField(content, "Primary (?:Job )?Location|Job Location|Locations?");
  if (labelledLocation && hasConflictingLocation(labelledLocation, context.city)) return undefined;
  return roleListing({
    company,
    title,
    url,
    availability: listingAvailability(content, now),
    matchReason: matchReason({
      title,
      text: content,
      city: context.city,
      location: labelledLocation,
      now,
    }),
  });
}

export function formatRolesReply(
  listings: readonly RoleListing[],
  namedFailures: readonly RolesNamedFailure[] = [],
): string {
  const lines: string[] = [];
  if (listings.length === 0) {
    lines.push("I didn't find a public listing I could read. I have not guessed.");
  } else {
    for (const listing of listings.slice(0, MAX_ROLE_LISTINGS)) {
      lines.push(`${listing.company} — ${listing.title}`);
      lines.push(`${listing.availability} · ${listing.matchReason}`);
      lines.push(listing.url);
      lines.push("");
    }
  }
  const failureLines = namedFailures.map(failureSentence).filter(Boolean);
  if (failureLines.length) {
    if (listings.length) lines.push("");
    lines.push(...failureLines);
  }
  lines.push("");
  lines.push(FIRSTROLE_SHORTLIST_LABEL);
  lines.push(FIRSTROLE_URL);
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export async function findRoles(input: FindRolesInput): Promise<FindRolesResult> {
  const now = input.now?.() ?? new Date();
  const firstRole = namedFirstRoleLink();
  const city = compact(input.city, 80);
  const queries = buildRolesSearchQueries(input.query, city, now);
  const empty = (namedFailures: RolesNamedFailure[]): FindRolesResult => ({
    listings: [],
    reply: formatRolesReply([], namedFailures),
    queries,
    searches: 0,
    fetches: 0,
    agentCalls: 0,
    namedFailures,
    firstRole,
  });
  if (city.length < 2) return empty(["invalid_city"]);
  if (queries.length === 0) return empty(["invalid_query"]);

  const namedFailures: RolesNamedFailure[] = [];
  const hits: LodgeSearchHit[] = [];
  let searches = 0;
  let fetches = 0;
  let agentCalls = 0;
  let verifiedUrl: string | undefined;

  for (let index = 0; index < queries.length; index += 1) {
    if (index >= 2 && countJobDetails(hits) >= 3) break;
    searches += 1;
    try {
      const found = await input.tinyfish.search(queries[index]!);
      hits.push(...found.filter((hit) => typeof hit?.url === "string"));
    } catch (error) {
      namedFailures.push(tinyfishFailure(error));
    }
  }

  const urls = selectListingUrls(hits, city);
  const fetched = new Map<string, LodgeFetchedPage>();
  const listings: RoleListing[] = [];
  const jsPortals: string[] = [];

  const read = async (url: string): Promise<LodgeFetchedPage | undefined> => {
    const existing = fetched.get(url);
    if (existing) return existing;
    if (fetches >= MAX_ROLES_LISTING_FETCHES) return undefined;
    fetches += 1;
    try {
      const page = await input.tinyfish.fetch(url);
      const normalized: LodgeFetchedPage = {
        title: page.title,
        url: publicListingUrl(page.url) ?? url,
        text: typeof page.text === "string" ? page.text : "",
        ...(page.finalUrl ? { finalUrl: page.finalUrl } : {}),
      };
      fetched.set(url, normalized);
      const finalUrl = publicListingUrl(normalized.finalUrl || normalized.url);
      if (finalUrl) fetched.set(finalUrl, normalized);
      return normalized;
    } catch (error) {
      namedFailures.push(tinyfishFailure(error));
      return undefined;
    }
  };

  for (const url of urls) {
    if (fetches >= MAX_ROLES_LISTING_FETCHES) break;
    const page = await read(url);
    if (!page) continue;
    const listing = extractRoleListing(page, { city, now });
    if (listing) listings.push(listing);
    else if (looksLikeJsPortal(page)) jsPortals.push(publicListingUrl(page.finalUrl || page.url) ?? url);
    for (const followup of observedJobLinks(page, city)) {
      if (listings.length >= MAX_ROLE_LISTINGS) break;
      if (fetches >= MAX_ROLES_LISTING_FETCHES) break;
      if (fetched.has(followup)) continue;
      const child = await read(followup);
      if (!child) continue;
      const childListing = extractRoleListing(child, { city, now });
      if (childListing) listings.push(childListing);
      else if (looksLikeJsPortal(child)) {
        jsPortals.push(publicListingUrl(child.finalUrl || child.url) ?? followup);
      }
    }
  }

  const portal = jsPortals.find((url) => !isAggregator(url));
  if (portal && agentCalls < MAX_ROLES_AGENT_CALLS && uniqueListings(listings).length < MAX_ROLE_LISTINGS) {
    agentCalls += 1;
    try {
      const agentPage = await input.tinyfish.agent({
        url: portal,
        goal: ROLES_AGENT_GOAL,
        goalId: ROLES_AGENT_GOAL_ID,
      });
      const fromAgent = listingFromAgent(agentPage, { city, now });
      const verifyTarget = publicListingUrl(agentPage.url) ?? portal;
      verifiedUrl = verifyTarget;
      fetches += 1;
      try {
        const verifiedPage = await input.tinyfish.fetch(verifyTarget);
        const extracted = extractRoleListing(verifiedPage, { city, now });
        if (extracted) listings.push(extracted);
        else if (fromAgent) {
          const confirmed = confirmAgentOnPage(fromAgent, verifiedPage);
          listings.push(
            confirmed
              ? roleListing({
                  ...fromAgent,
                  availability: listingAvailability(verifiedPage.text, now),
                })
              : roleListing({ ...fromAgent, availability: "unverified" }),
          );
          if (!confirmed) namedFailures.push("fetch_verify_unreadable");
        } else {
          namedFailures.push("fetch_verify_unreadable");
        }
      } catch (error) {
        if (fromAgent && isRemovedError(error)) {
          listings.push(roleListing({ ...fromAgent, availability: "closed" }));
        } else {
          if (fromAgent) listings.push(roleListing({ ...fromAgent, availability: "unverified" }));
          namedFailures.push(isRemovedError(error) ? "fetch_verify_unreadable" : tinyfishFailure(error));
        }
      }
    } catch (error) {
      namedFailures.push(tinyfishFailure(error) === "tinyfish_timeout" ? "tinyfish_timeout" : "agent_unreadable");
    }
  }

  const ranked = rankListings(uniqueListings(listings)).slice(0, MAX_ROLE_LISTINGS);
  return {
    listings: ranked,
    reply: formatRolesReply(ranked, namedFailures),
    queries,
    searches,
    fetches,
    agentCalls,
    ...(verifiedUrl ? { verifiedUrl } : {}),
    namedFailures,
    firstRole,
  };
}

function roleListing(input: Omit<RoleListing, "stillOpen">): RoleListing {
  return { ...input, stillOpen: input.availability };
}

function listingFromAgent(
  page: LodgeAgentPage,
  context: { city: string; now: Date },
): RoleListing | undefined {
  const url = publicListingUrl(page.url);
  if (!url) return undefined;
  const excerpt = page.excerpt ?? "";
  const title = listingTitle({ title: page.title, url, text: excerpt }, excerpt);
  const company = listingCompany({ title: page.title, url, text: excerpt }, excerpt, title ?? "");
  if (!title || !company) return undefined;
  if (!includesIgnoreCase(`${excerpt} ${page.title}`, title)) return undefined;
  if (!includesIgnoreCase(`${excerpt} ${page.title}`, company)) return undefined;
  if (SENIOR.test(title)) return undefined;
  return roleListing({
    company: compact(company, 160),
    title: compact(title, 200),
    url,
    availability: "unverified",
    matchReason: matchReason({
      title,
      text: excerpt,
      city: context.city,
      location: labelledField(excerpt, "Location|Locations?"),
      now: context.now,
    }),
  });
}

function confirmAgentOnPage(listing: RoleListing, page: LodgeFetchedPage): boolean {
  const haystack = `${page.title}\n${page.text}`;
  return includesIgnoreCase(haystack, listing.company) && includesIgnoreCase(haystack, listing.title);
}

function selectListingUrls(hits: LodgeSearchHit[], city: string): string[] {
  const scored: Array<{ url: string; score: number; host: string }> = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const url = publicListingUrl(hit.url);
    if (!url || seen.has(url) || isAggregator(url)) continue;
    seen.add(url);
    const detail = isJobDetailUrl(url);
    const blob = `${hit.title} ${hit.snippet} ${url}`.toLowerCase();
    if (detail && SENIOR.test(hit.title) && !EARLY_CAREER.test(hit.title)) continue;
    const located = includesIgnoreCase(`${hit.title} ${hit.snippet}`, city);
    const early = EARLY_CAREER.test(blob);
    const score = (detail ? 35 : 10) + (located ? 22 : 0) + (early ? 20 : 0) + (isAts(url) ? 8 : 0);
    scored.push({ url, score, host: companyKey(url) });
  }
  scored.sort((left, right) => right.score - left.score);
  const chosen: string[] = [];
  const hosts = new Set<string>();
  for (const candidate of scored) {
    if (chosen.length === MAX_ROLES_LISTING_FETCHES) break;
    if (hosts.has(candidate.host)) continue;
    chosen.push(candidate.url);
    hosts.add(candidate.host);
  }
  for (const candidate of scored) {
    if (chosen.length === MAX_ROLES_LISTING_FETCHES) break;
    if (!chosen.includes(candidate.url)) chosen.push(candidate.url);
  }
  return chosen;
}

function observedJobLinks(page: LodgeFetchedPage, city: string): string[] {
  const found = new Set<string>();
  const hay = page.text.slice(0, 60_000);
  for (const match of hay.matchAll(/\[([^\]]{1,250})\]\((https:\/\/[^\s)]+)\)/g)) {
    const url = publicListingUrl(match[2]!);
    const label = match[1] ?? "";
    if (url && isJobDetailUrl(url) && (EARLY_CAREER.test(`${url} ${label}`) || includesIgnoreCase(label, city))) {
      found.add(url);
    }
  }
  return [...found].slice(0, 2);
}

function publicListingUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const guarded = guardPublicUrl(value);
  if (!guarded.ok) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(guarded.normalized);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") return undefined;
  if (parsed.username || parsed.password) return undefined;
  if (/\.(pdf|docx?|xlsx?|zip)$/i.test(parsed.pathname)) return undefined;
  if (/(?:^|\.)google\.com$/.test(parsed.hostname)) return undefined;
  if (
    /(?:^|\.)(youtube\.com|facebook\.com|instagram\.com|reddit\.com|pinterest\.com|tiktok\.com)$/.test(
      parsed.hostname,
    )
  ) {
    return undefined;
  }
  if (/\/(blog|news|article|advice|salary|salaries|login|signin|accounts)(\/|$)/i.test(parsed.pathname)) {
    return undefined;
  }
  const hay = `${parsed.hostname}${parsed.pathname}`;
  if (
    !/career|jobs?|vacanc|intern|greenhouse|lever\.co|ashbyhq|workable|myworkdayjobs|smartrecruiters|successfactors|taleo|icims|bamboohr|early.?career/i.test(
      hay,
    )
  ) {
    return undefined;
  }
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString();
}

function listingTitle(page: LodgeFetchedPage, content: string): string | undefined {
  const headings = [...content.matchAll(/^#{1,2}\s+([^\n]+)/gm)]
    .map((match) => compact(match[1] ?? "", 200))
    .filter(
      (value) =>
        value &&
        !/^(careers?|welcome|job (?:search|details|description)|search results|locations?|posted on)\b/i.test(
          value,
        ),
    );
  const fromPage = compact((page.title || "").replace(/\s+at\s+.+$/i, "").split(/\s+(?:\||–|—)\s+/)[0] ?? "", 200);
  const title = headings[0] || fromPage;
  if (!title || /^(careers?|job search|jobs|search results|access denied|sign in)$/i.test(title)) {
    return undefined;
  }
  if (!includesIgnoreCase(`${content}\n${page.title}`, title)) return undefined;
  return title;
}

function listingCompany(page: LodgeFetchedPage, content: string, title: string): string | undefined {
  const labelled = labelledField(content, "Company|Employer|Hiring organization");
  const atTitle = title.match(/\s+at\s+(.+)$/i)?.[1];
  const atPage = (page.title || "").match(/\s+at\s+(.+)$/i)?.[1];
  const company = compact(labelled || atTitle || atPage || "", 160);
  if (!company || /^(careers?|jobs?|unknown|not stated)$/i.test(company)) return undefined;
  if (!includesIgnoreCase(`${content}\n${page.title}`, company)) return undefined;
  return company;
}

function matchReason(input: {
  title: string;
  text: string;
  city: string;
  location?: string;
  now: Date;
}): string {
  const parts: string[] = [];
  const blob = `${input.title}\n${input.text}`;
  if (/\bintern(?:ship)?\b/i.test(blob)) parts.push("internship");
  else if (/\b(?:graduate|new grad)\b/i.test(blob)) parts.push("graduate");
  else if (/\b(?:entry[- ]level|junior|trainee)\b/i.test(blob)) parts.push("entry-level");
  const place = compact(input.city, 80);
  const locationHay = input.location || labelledField(input.text, "Location|Locations?") || "";
  if (place && includesIgnoreCase(`${locationHay}\n${input.title}\n${input.text.slice(0, 1_500)}`, place)) {
    parts.push(place);
  }
  if (postedThisWeek(blob, input.now)) parts.push("posted this week");
  if (parts.length === 0) parts.push("public listing");
  return parts.join(", ");
}

function postedThisWeek(text: string, now: Date): boolean {
  if (/\bposted this week\b/i.test(text)) return true;
  const windowMs = 7 * 86_400_000;
  for (const match of text.matchAll(
    /\bposted(?:\s+on)?\s+(\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2}|[A-Za-z]{3,9}\s+\d{1,2},?\s+20\d{2})\b/gi,
  )) {
    const stamp = parseDate(match[1] ?? "");
    if (stamp !== undefined && now.getTime() - stamp >= 0 && now.getTime() - stamp <= windowMs) return true;
  }
  return false;
}

function deadlinePassed(text: string, now: Date): boolean {
  const match = text.match(
    /\b(?:deadline|closing date|applications? close|apply (?:before|by))\s*:?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2}|[A-Za-z]{3,9}\s+\d{1,2},?\s+20\d{2})/i,
  );
  if (!match) return false;
  const stamp = parseDate(match[1] ?? "");
  if (stamp === undefined) return false;
  return new Date(stamp).toISOString().slice(0, 10) < now.toISOString().slice(0, 10);
}

function parseDate(value: string): number | undefined {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const stamp = Date.parse(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`);
    return Number.isFinite(stamp) ? stamp : undefined;
  }
  const english = value.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})$|^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(20\d{2})$/);
  if (!english) return undefined;
  const day = Number(english[1] || english[5]);
  const month = MONTHS[(english[2] || english[4] || "").toLowerCase()];
  const year = Number(english[3] || english[6]);
  if (!Number.isInteger(day) || month === undefined) return undefined;
  const stamp = Date.UTC(year, month, day);
  return Number.isFinite(stamp) ? stamp : undefined;
}

function labelledField(visible: string, labels: string): string | undefined {
  const match = visible.match(
    new RegExp(`(?:^|\\n)\\s*(?:\\*\\*)?(?:${labels})(?:\\*\\*)?\\s*[:：]\\s*([^\\n]+)`, "i"),
  );
  const value = compact(
    (match?.[1] ?? "")
      .replace(/[#*_`\[\]]/g, " ")
      .split(/\s+(?:Location|Company|Employer|Posted|Deadline|Apply)\s*:/i)[0] ?? "",
    160,
  );
  return value && !/not (?:specified|stated)/i.test(value) ? value : undefined;
}

function hasConflictingLocation(value: string, requested: string): boolean {
  const source = placeText(value);
  const wanted = placeText(requested);
  if (!wanted || includesPlace(source, wanted)) return false;
  const sourceCountry = countryOf(source);
  const wantedCountry = countryOf(wanted);
  if (sourceCountry && wantedCountry && sourceCountry !== wantedCountry) return true;
  if (!sourceCountry) return false;
  const specific = Object.values(COUNTRY_AREAS)
    .flat()
    .some((alias) => alias.length > 2 && includesPlace(source, alias) && !includesPlace(wanted, alias));
  return specific && !includesPlace(source, wanted);
}

function countryOf(value: string): string | undefined {
  return Object.entries(COUNTRY_AREAS).find(([, aliases]) =>
    aliases.some((alias) => includesPlace(value, alias)),
  )?.[0];
}

function alternativeCity(city: string): string {
  if (/^united arab emirates$/i.test(city) || /^dubai$/i.test(city)) return "UAE";
  if (/^united states$/i.test(city)) return "USA";
  if (/^united kingdom$/i.test(city)) return "UK";
  return city;
}

function rankListings(listings: RoleListing[]): RoleListing[] {
  const rank = (availability: RoleAvailability) =>
    availability === "open" ? 2 : availability === "unverified" ? 1 : 0;
  return [...listings].sort((left, right) => rank(right.availability) - rank(left.availability));
}

function uniqueListings(listings: RoleListing[]): RoleListing[] {
  const seen = new Map<string, RoleListing>();
  for (const listing of listings) seen.set(listing.url, listing);
  return [...seen.values()];
}

function countJobDetails(hits: LodgeSearchHit[]): number {
  return new Set(
    hits.map((hit) => publicListingUrl(hit.url)).filter((url): url is string => Boolean(url && isJobDetailUrl(url))),
  ).size;
}

function companyKey(url: string): string {
  const parsed = new URL(url);
  if (/greenhouse\.io$|lever\.co$|ashbyhq\.com$|smartrecruiters\.com$|workable\.com$/.test(parsed.hostname)) {
    return `${parsed.hostname}/${parsed.pathname.split("/").filter(Boolean)[0] || ""}`;
  }
  return parsed.hostname;
}

function isAggregator(url: string): boolean {
  const host = new URL(url).hostname;
  return AGGREGATORS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function isAts(url: string): boolean {
  return /greenhouse\.io$|lever\.co$|ashbyhq\.com$|myworkdayjobs\.com$|smartrecruiters\.com$|workable\.com$/.test(
    new URL(url).hostname,
  );
}

function tinyfishFailure(error: unknown): RolesNamedFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out/i.test(message)) return "tinyfish_timeout";
  if (/private/i.test(message)) return "private_url";
  return "tinyfish_failure";
}

function isRemovedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /410|not found|no longer available|listing_removed|removed/i.test(message);
}

function failureSentence(failure: RolesNamedFailure): string {
  switch (failure) {
    case "tinyfish_timeout":
      return "A TinyFish check timed out.";
    case "tinyfish_failure":
      return "A TinyFish check failed.";
    case "private_url":
      return "A private URL was skipped.";
    case "agent_unreadable":
      return "The careers page could not be opened read-only.";
    case "fetch_verify_unreadable":
      return "I could not verify that listing is still open.";
    case "invalid_query":
    case "invalid_city":
      return "";
  }
}

function includesIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function includesPlace(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

function placeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function compact(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
