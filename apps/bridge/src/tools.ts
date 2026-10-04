import { randomUUID } from "node:crypto";
import {
  LODGE_AGENT_GOAL_TEMPLATES,
  extractStudentUrls,
  guardPublicUrl,
  type LodgeAgentGoalId,
  type LodgeFetchedPage,
  type LodgeLocalToolHandler,
  type LodgeLocalToolResult,
  type LodgeTinyFishPort,
  type LodgeToolName,
} from "./agent.js";
import {
  namedGoogleCalendarLink,
  namedLodgeIcsLink,
  namedLodgeWeekIcsLink,
  pickCalendarEvent,
  type CalendarEvent,
} from "./calendar.js";
import { firstPublicUrl, saveLink } from "./checkin.js";
import { formatHumanLocalTime } from "./grounding.js";
import {
  addNote,
  clashLine,
  forgetNote,
  notesOf,
  pinOpportunity,
  pinSources,
  showNotes,
  weekEvents,
} from "./notebook.js";
import { findRoles, type RoleListing } from "./roles.js";
import { buildSlipUrl } from "./slips.js";
import { formatHowDidYouGetThat } from "./trace.js";
import {
  LODGE_DEFAULT_TIMEZONE,
  LODGE_PENDING_REMINDERS_CAP,
  type BridgeStore,
  type ConversationMemory,
  type LodgeLinkKind,
  type PendingReminder,
} from "./types.js";

export const FIRSTROLE_URL = "https://firstrole.hamdanesmail12-7a9.workers.dev";
export const FIRSTROLE_LINE = `Full shortlist on FirstRole → ${FIRSTROLE_URL}`;

/** TinyFish Search / Fetch / Agent aliases used in the Lodge desk (never Browser). */
export const TINYFISH_DESK = {
  search_web: "tinyfish_search",
  read_pages: "tinyfish_fetch",
  browse_page: "tinyfish_agent",
} as const;

export type LodgeRoleListing = {
  company: string;
  title: string;
  url: string;
  stillOpen?: "open" | "closed" | "unverified";
  matchReason?: string;
};

export interface LodgeRolesFinder {
  findRoles(input: { query: string; city: string }): Promise<LodgeRoleListing[]>;
}

export type LodgeToolProgress = (label: string) => Promise<void>;

export type LodgeToolsContext = {
  store: BridgeStore;
  conversationKey: string;
  now: () => Date;
  tinyfish?: LodgeTinyFishPort;
  roles?: LodgeRolesFinder;
  onProgress?: LodgeToolProgress;
};

export type LodgeToolReply = {
  bubbles: string[];
  slip?: { title: string; url?: string; start?: string; end?: string; location?: string };
};

export function createLodgeTinyFishPort(port: LodgeTinyFishPort): LodgeTinyFishPort {
  return {
    search: (query) => port.search(query),
    fetch: (url) => port.fetch(url),
    agent: (input) => port.agent(input),
  };
}

export function toDeskListing(listing: RoleListing): LodgeRoleListing {
  return {
    company: listing.company,
    title: listing.title,
    url: listing.url,
    stillOpen: listing.availability,
    matchReason: listing.matchReason,
  };
}

/** Offline-mockable FirstRole-shaped finder. Wave 4 can pass a live TinyFish port. */
export function createTinyFishRolesFinder(
  tinyfish: LodgeTinyFishPort,
  now?: () => Date,
): LodgeRolesFinder {
  return {
    async findRoles(input) {
      const result = await findRoles({ query: input.query, city: input.city, tinyfish, now });
      return result.listings.slice(0, 3).map(toDeskListing);
    },
  };
}

export function createLodgeTools(context: LodgeToolsContext): LodgeLocalToolHandler {
  return {
    async execute(name: string, args: Record<string, unknown>): Promise<LodgeLocalToolResult> {
      const memory = await loadMemory(context);
      const result = await runTool(name as LodgeToolName, args, memory, context);
      await context.store.putConversation(context.conversationKey, result.memory);
      return { content: result.content, citations: result.citations };
    },
  };
}

export function formatLodgeToolContent(name: string, content: string): LodgeToolReply {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return { bubbles: [content] };
  }
  if (parsed.ok === false) {
    const error = typeof parsed.error === "string" ? parsed.error : "named_failure";
    return { bubbles: [namedFailureCopy(error)] };
  }
  if (name === "find_roles") {
    const listings = Array.isArray(parsed.listings) ? parsed.listings as LodgeRoleListing[] : [];
    const lines = listings.slice(0, 3).map((listing, index) => formatListing(index + 1, listing));
    const body = lines.length > 0
      ? lines.join("\n")
      : (typeof parsed.message === "string" ? parsed.message : "I did not find a verified public listing I can stand behind.");
    return { bubbles: [body, FIRSTROLE_LINE] };
  }
  if (name === "add_to_calendar") {
    const google = record(parsed.google);
    const ics = record(parsed.ics);
    const slip = record(parsed.slip);
    const bubbles = [
      "Save it yourself — Lodge never adds a calendar event for you.",
      typeof google.label === "string" && typeof google.url === "string" ? `${google.label}\n${google.url}` : "",
      typeof ics.label === "string" && typeof ics.url === "string" ? `${ics.label}\n${ics.url}` : "",
    ].filter(Boolean);
    return {
      bubbles: bubbles.slice(0, 3),
      slip: typeof slip.url === "string"
        ? { title: String(parsed.title ?? "Event"), url: String(slip.url) }
        : undefined,
    };
  }
  if (name === "plan_week") {
    const week = record(parsed.week);
    const label = typeof week.label === "string" ? week.label : "Lodge week file";
    const url = typeof week.url === "string" ? week.url : "";
    return {
      bubbles: url
        ? ["One-tap week file. Lodge never adds it without Save.", `${label}\n${url}`]
        : [typeof parsed.message === "string" ? parsed.message : "Nothing dated in the notebook this week."],
    };
  }
  if (name === "draft_message") {
    return {
      bubbles: [
        typeof parsed.draft === "string" ? parsed.draft : "I could not draft that.",
        "I have not sent this.",
      ],
    };
  }
  if (typeof parsed.message === "string") {
    const extra = typeof parsed.detail === "string" ? parsed.detail : undefined;
    return { bubbles: extra ? [parsed.message, extra] : [parsed.message] };
  }
  if (typeof parsed.ledger === "string") return { bubbles: [parsed.ledger] };
  return { bubbles: [content.slice(0, 900)] };
}

export function parseReminderWhen(
  when: string,
  now: Date,
  timeZone: string,
): Date | undefined {
  const text = when.replace(/\s+/g, " ").trim();
  const relative = text.match(/^(?:in\s+)?(\d+)\s*(minutes?|mins?|m|hours?|hrs?|h)$/i);
  if (relative) {
    const amount = Number(relative[1]);
    if (!Number.isFinite(amount) || amount <= 0) return undefined;
    const ms = /^h/i.test(relative[2] ?? "") ? 3_600_000 : 60_000;
    return new Date(now.getTime() + amount * ms);
  }
  const iso = Date.parse(text);
  if (Number.isFinite(iso)) return new Date(iso);

  let addDays = 0;
  let clockText = text.replace(/^at\s+/i, "");
  if (/^tomorrow\b/i.test(clockText)) {
    addDays = 1;
    clockText = clockText.replace(/^tomorrow\s*(?:at\s+)?/i, "");
  }
  const clock = parseClock(clockText);
  if (!clock && addDays === 1) return fromZonedWall(now, timeZone, 1, 9, 0);
  if (!clock) return undefined;
  let fire = fromZonedWall(now, timeZone, addDays, clock.hour, clock.minute);
  if (addDays === 0 && fire.getTime() <= now.getTime()) {
    fire = fromZonedWall(now, timeZone, 1, clock.hour, clock.minute);
  }
  return fire;
}

async function runTool(
  name: LodgeToolName,
  args: Record<string, unknown>,
  memory: ConversationMemory,
  context: LodgeToolsContext,
): Promise<{ memory: ConversationMemory; content: string; citations?: LodgeLocalToolResult["citations"] }> {
  const now = context.now();
  const timeZone = memory.timezone ?? LODGE_DEFAULT_TIMEZONE;

  if (name === "save_link") {
    const url = String(args.url ?? "");
    const kind = (args.kind as LodgeLinkKind | undefined) ?? "other";
    const guarded = guardPublicUrl(url);
    if (!guarded.ok) return { memory, content: fail(guarded.reason === "private" ? "private_url" : "invalid") };
    const next = saveLink(memory, { kind, url: guarded.normalized }, now);
    next.pendingRememberPage = undefined;
    return {
      memory: next,
      content: ok({
        message: "Saved that public page. I can watch it for a real change — never a ‘no change’ ping.",
        url: guarded.normalized,
        kind,
      }),
    };
  }

  if (name === "whats_due" || name === "whats_on") {
    const kind = name === "whats_due" ? "course" : "events";
    const saved = (memory.savedLinks ?? []).find((link) => link.kind === kind) ?? memory.savedLinks?.[0];
    if (!saved) {
      return {
        memory,
        content: ok({
          message: name === "whats_due"
            ? "I don’t have a course page yet. Paste a public syllabus URL, or skip check-in and send one later."
            : "I don’t have an events page yet. Paste a public events URL when you have one.",
        }),
      };
    }
    if (!context.tinyfish) return { memory, content: fail("tinyfish_not_wired") };
    await context.onProgress?.(name === "whats_due" ? "Reading your page…" : "Reading the events page…");
    const pages = await readPageAndChildren(context.tinyfish, saved.url, kind);
    const citations = pages.map((page, index) => ({
      traceId: `T${index + 1}`,
      tool: "fetch" as const,
      url: page.url,
      title: page.title,
      text: page.text,
    }));
    const dates = collectDateLines(pages);
    return {
      memory,
      citations,
      content: ok({
        message: dates.length > 0
          ? dates.slice(0, 6).join("\n")
          : `I read ${saved.url} but did not find dates I can stand behind.`,
        url: saved.url,
        pages: pages.map((page) => page.url),
      }),
    };
  }

  if (name === "read_form") {
    const url = String(args.url ?? "");
    const guarded = guardPublicUrl(url);
    if (!guarded.ok) return { memory, content: fail(guarded.reason === "private" ? "private_url" : "invalid") };
    if (!context.tinyfish) return { memory, content: fail("tinyfish_not_wired") };
    await context.onProgress?.("Opening it read-only…");
    try {
      const page = await context.tinyfish.agent({
        url: guarded.normalized,
        goalId: "form_questions" satisfies LodgeAgentGoalId,
        goal: LODGE_AGENT_GOAL_TEMPLATES.form_questions,
      });
      return {
        memory,
        citations: [{
          traceId: "T1",
          tool: "agent",
          url: page.url,
          title: page.title,
          text: page.excerpt,
        }],
        content: ok({
          message: page.excerpt || "I opened the form read-only. I did not type or submit.",
          url: page.url,
          stillOpen: page.stillOpen ?? "unverified",
          note: "Read-only. Lodge never applies, signs in, or emails.",
        }),
      };
    } catch {
      return { memory, content: fail("tinyfish_failure") };
    }
  }

  if (name === "find_roles") {
    const query = String(args.query ?? "internship").slice(0, 200);
    const city = String(args.city ?? memory.rolesCity ?? "").slice(0, 80);
    const finder = context.roles ?? (context.tinyfish
      ? createTinyFishRolesFinder(context.tinyfish, context.now)
      : undefined);
    let listings: LodgeRoleListing[] = [];
    if (finder && city) {
      try {
        listings = (await finder.findRoles({ query, city })).slice(0, 3);
      } catch {
        listings = [];
      }
    }
    const next: ConversationMemory = {
      ...memory,
      rolesCity: city || memory.rolesCity,
      updatedAt: now.toISOString(),
    };
    if (listings.length > 0) {
      next.lastResearch = {
        query: city ? `${query} in ${city}` : query,
        topic: "roles",
        mode: "answer",
        checkedAt: now.toISOString(),
        endpoints: ["search", "fetch"],
        sources: listings.map((listing) => ({
          title: `${listing.company} — ${listing.title}`,
          url: listing.url,
          excerpt: listing.matchReason ?? listing.title,
          endpoint: "fetch",
        })),
      };
      const first = listings[0]!;
      next.pendingRememberPage = {
        url: first.url,
        title: `${first.company} — ${first.title}`,
        kind: "opportunity",
        offeredAt: now.toISOString(),
      };
    }
    return {
      memory: next,
      content: ok({
        listings,
        city,
        firstRole: FIRSTROLE_URL,
        message: listings.length === 0
          ? city
            ? `No listings I can verify for ${city} this turn.`
            : "Tell me a city (skip is fine). Lodge never applies."
          : undefined,
      }),
    };
  }

  if (name === "clash_check") {
    const title = String(args.title ?? "");
    const start = String(args.start ?? "");
    const end = String(args.end ?? "");
    const clash = clashLine(memory, { title, start, end });
    return {
      memory,
      content: ok({
        message: clash ?? `${title} does not overlap the notebook.`,
        clash: Boolean(clash),
      }),
    };
  }

  if (name === "draft_message") {
    const audience = String(args.audience ?? "").trim();
    const topic = String(args.topic ?? "").trim();
    if (/(?:@|https?:\/\/)/i.test(audience) || /@/.test(topic)) {
      return { memory, content: fail("contact_not_allowed") };
    }
    const draft = [
      `Hi ${audience || "there"},`,
      "",
      `I’m writing about ${topic || "this"}.`,
      "",
      "Thank you.",
    ].join("\n");
    return {
      memory,
      content: ok({ draft, sent: false, message: "I have not sent this." }),
    };
  }

  if (name === "add_to_calendar") {
    try {
      const event = pickCalendarEvent({
        title: String(args.title ?? ""),
        start: String(args.start ?? ""),
        end: String(args.end ?? ""),
        location: nullableString(args.location),
        url: nullableString(args.url),
      });
      return { memory, content: calendarPayload(event, timeZone) };
    } catch (error) {
      return { memory, content: fail(error instanceof Error ? error.message : "invalid_event") };
    }
  }

  if (name === "notebook") {
    const action = String(args.action ?? "");
    const text = nullableString(args.text);
    if (action === "note") {
      if (!text) {
        return { memory, content: ok({ message: showNotes(memory) }) };
      }
      const added = addNote(memory, { text }, now);
      if (!added.ok) {
        return {
          memory,
          content: fail(added.reason === "full" ? "notebook_full" : "empty_note"),
        };
      }
      return {
        memory: added.memory,
        content: ok({ message: `Noted: ${added.note.text}`, id: added.note.id }),
      };
    }
    if (action === "pin") {
      if (text) {
        const listing = /internship|intern|role|opening/i.test(text)
          ? pinOpportunity(memory, { title: text }, now)
          : addNote(memory, { text }, now);
        if (!listing.ok) return { memory, content: fail(listing.reason === "full" ? "notebook_full" : "empty_note") };
        return {
          memory: listing.memory,
          content: ok({ message: `Pinned: ${listing.note.text}` }),
        };
      }
      if (memory.lastResearch?.topic === "roles" && (memory.lastResearch.sources?.length ?? 0) > 0) {
        let next = memory;
        let pinned = 0;
        for (const source of memory.lastResearch.sources.slice(0, 3)) {
          if (notesOf(next).some((note) => note.url === source.url)) continue;
          const [company, ...titleParts] = source.title.split(" — ");
          const added = pinOpportunity(next, {
            company,
            title: titleParts.join(" — ") || source.title,
            url: source.url,
          }, now);
          if (!added.ok) {
            return {
              memory: next,
              content: pinned > 0
                ? ok({ message: `Pinned ${pinned} opening${pinned === 1 ? "" : "s"}.`, full: added.reason === "full" })
                : fail(added.reason === "full" ? "notebook_full" : "empty_note"),
            };
          }
          next = added.memory;
          pinned += 1;
        }
        return {
          memory: next,
          content: ok({
            message: pinned > 0
              ? `Pinned ${pinned} opening${pinned === 1 ? "" : "s"}.`
              : "Nothing recent to pin. Heart a list after a lookup.",
          }),
        };
      }
      const sources = memory.lastResearch?.sources ?? [];
      if (sources.length === 0 && memory.pendingRememberPage) {
        const added = addNote(memory, {
          text: memory.pendingRememberPage.title ?? memory.pendingRememberPage.url,
          url: memory.pendingRememberPage.url,
        }, now);
        if (!added.ok) return { memory, content: fail("notebook_full") };
        return {
          memory: { ...added.memory, pendingRememberPage: undefined },
          content: ok({ message: `Pinned: ${added.note.text}` }),
        };
      }
      const pinned = pinSources(memory, sources, now);
      return {
        memory: pinned.memory,
        content: ok({
          message: pinned.pinned > 0
            ? `Pinned ${pinned.pinned} line${pinned.pinned === 1 ? "" : "s"}.`
            : "Nothing recent to pin. Heart a list after a lookup.",
          full: pinned.full,
        }),
      };
    }
    if (action === "forget") {
      const forgotten = forgetNote(memory, text);
      if (!forgotten.ok) {
        return { memory, content: fail(forgotten.reason === "empty" ? "notebook_empty" : "note_missing") };
      }
      return {
        memory: forgotten.memory,
        content: ok({ message: `Forgot: ${forgotten.removed.text}` }),
      };
    }
    return { memory, content: fail("invalid_arguments") };
  }

  if (name === "remind_me") {
    const text = String(args.text ?? "Reminder").slice(0, 240);
    const when = String(args.when ?? "");
    const fire = parseReminderWhen(when, now, timeZone);
    if (!fire) return { memory, content: fail("invalid_when") };
    const reminders = [...(memory.pendingReminders ?? [])];
    if (reminders.length >= LODGE_PENDING_REMINDERS_CAP) return { memory, content: fail("reminders_full") };
    const localFireLabel = formatHumanLocalTime(fire.toISOString(), timeZone, now);
    const reminder: PendingReminder = {
      id: randomUUID(),
      text,
      fireAt: fire.toISOString(),
      createdAt: now.toISOString(),
      status: "pending_confirm",
      ignoreQuietHours: true,
      localFireLabel,
    };
    reminders.push(reminder);
    return {
      memory: { ...memory, pendingReminders: reminders, updatedAt: now.toISOString() },
      content: ok({
        message: `I’ll text first at ${localFireLabel}. Reply YES to confirm. 👍 later marks it done.`,
        reminderId: reminder.id,
        fireAt: reminder.fireAt,
        localFireLabel,
      }),
    };
  }

  if (name === "show_trace") {
    return {
      memory,
      content: ok({
        ledger: memory.lastTrace
          ? formatHowDidYouGetThat(memory.lastTrace)
          : "I have not checked a live page this turn.",
      }),
    };
  }

  if (name === "plan_week") {
    const events = weekEvents(memory, now);
    if (events.length === 0) {
      return { memory, content: ok({ message: "Nothing dated in the notebook this week." }) };
    }
    try {
      const week = namedLodgeWeekIcsLink(events as CalendarEvent[]);
      return {
        memory,
        content: ok({
          week,
          count: events.length,
          message: "One Lodge week file. Save it yourself — I never add the calendar for you.",
        }),
      };
    } catch (error) {
      return { memory, content: fail(error instanceof Error ? error.message : "invalid_week") };
    }
  }

  return { memory, content: fail("unknown_tool") };
}

async function loadMemory(context: LodgeToolsContext): Promise<ConversationMemory> {
  return await context.store.getConversation(context.conversationKey) ?? {
    courses: [],
    watches: [],
    updatedAt: context.now().toISOString(),
  };
}

async function readPageAndChildren(
  tinyfish: LodgeTinyFishPort,
  url: string,
  kind: "course" | "events",
): Promise<LodgeFetchedPage[]> {
  const pages: LodgeFetchedPage[] = [];
  const root = await tinyfish.fetch(url);
  pages.push(root);
  const children = childLinks(root, kind).slice(0, 2);
  for (const child of children) {
    try {
      pages.push(await tinyfish.fetch(child));
    } catch {
      // Keep the parent page if a child fetch fails.
    }
  }
  return pages;
}

function childLinks(page: LodgeFetchedPage, kind: "course" | "events"): string[] {
  const candidates = extractStudentUrls(page.text)
    .map((url) => guardPublicUrl(url))
    .filter((result): result is { ok: true; normalized: string } => result.ok)
    .map((result) => result.normalized)
    .filter((url) => url !== page.url);

  const scored = candidates.map((url) => ({ url, score: childScore(url, kind) }));
  scored.sort((left, right) => right.score - left.score);
  const hasDates = /\b(?:due|deadline|monday|friday|october|\d{1,2}:\d{2})\b/i.test(page.text);
  const picked: string[] = [];
  for (const item of scored) {
    if (picked.length >= 2) break;
    if (item.score <= 0 && hasDates) continue;
    if (!hasDates && /\.pdf(?:$|[?#])/i.test(item.url)) {
      picked.push(item.url);
      continue;
    }
    if (item.score > 0) picked.push(item.url);
  }
  return picked;
}

function childScore(url: string, kind: "course" | "events"): number {
  const hay = url.toLowerCase();
  let score = 0;
  if (kind === "course") {
    if (/syllabus|calendar|schedule|deadline|assignment/.test(hay)) score += 3;
  } else if (/event|calendar|schedule|whats-on|whatson/.test(hay)) {
    score += 3;
  }
  if (/\.pdf(?:$|[?#])/i.test(hay)) score += 1;
  return score;
}

function collectDateLines(pages: LodgeFetchedPage[]): string[] {
  const lines: string[] = [];
  for (const page of pages) {
    for (const line of page.text.split(/\n+/)) {
      if (!/\b(?:due|deadline|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}:\d{2})\b/i.test(line)) {
        continue;
      }
      const compact = line.replace(/\s+/g, " ").trim().slice(0, 160);
      if (compact && !lines.includes(compact)) lines.push(`${compact} (${page.url})`);
    }
  }
  return lines;
}

function calendarPayload(event: CalendarEvent, timeZone: string): string {
  const google = namedGoogleCalendarLink(event, { timeZone });
  const ics = namedLodgeIcsLink(event, { timeZone });
  const slipUrl = buildSlipUrl(event);
  const maps = event.location
    ? `https://maps.apple.com/?q=${encodeURIComponent(event.location)}`
    : undefined;
  return ok({
    title: event.title,
    google,
    ics,
    slip: { label: event.title, url: slipUrl },
    maps,
    saveHint: "Tap Save / Add to calendar. Lodge never adds it for you.",
  });
}

function formatListing(index: number, listing: LodgeRoleListing): string {
  const badge = listing.stillOpen === "open"
    ? "still open"
    : listing.stillOpen === "closed"
      ? "closed"
      : "unverified";
  const reason = listing.matchReason ? ` — ${listing.matchReason}` : "";
  return `${index}. ${listing.company}: ${listing.title} (${badge})${reason}\n${listing.url}`;
}

function namedFailureCopy(error: string): string {
  switch (error) {
    case "notebook_full":
      return "Notebook is full (30). Forget a line first.";
    case "notebook_empty":
      return "Notebook is empty.";
    case "tinyfish_not_wired":
      return "I can’t read the page this turn. I have not guessed.";
    case "contact_not_allowed":
      return "I draft notes to a role (professor, advisor). I never email or send them.";
    case "invalid_when":
      return "Tell me when, like “in 5 minutes”.";
    case "private_url":
      return "That URL isn’t a public page I can fetch.";
    default:
      return `I could not finish that (${error.replaceAll("_", " ")}). I have not guessed.`;
  }
}

function parseClock(text: string): { hour: number; minute: number } | undefined {
  const match = text.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (!Number.isFinite(hour) || hour > 23 || minute > 59) return undefined;
  if (meridiem) {
    if (hour === 12) hour = 0;
    if (meridiem.startsWith("p")) hour += 12;
  }
  return { hour, minute };
}

function fromZonedWall(
  now: Date,
  timeZone: string,
  addDays: number,
  hour: number,
  minute: number,
): Date {
  const base = new Date(now.getTime() + addDays * 24 * 60 * 60 * 1_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(base);
  const num = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const year = num("year");
  const month = num("month");
  const day = num("day");
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i += 1) {
    const seen = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const seenNum = (type: Intl.DateTimeFormatPartTypes) =>
      Number(seen.find((part) => part.type === type)?.value);
    const desired = Date.UTC(year, month - 1, day, hour, minute);
    const actual = Date.UTC(seenNum("year"), seenNum("month") - 1, seenNum("day"), seenNum("hour"), seenNum("minute"));
    const delta = desired - actual;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}

function nullableString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function ok(payload: Record<string, unknown>): string {
  return JSON.stringify({ ok: true, ...payload });
}

function fail(error: string): string {
  return JSON.stringify({ ok: false, error });
}

export { firstPublicUrl };
