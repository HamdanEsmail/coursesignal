import { randomUUID } from "node:crypto";
import { extractStudentUrls, guardPublicUrl } from "./agent.js";
import {
  LODGE_DEFAULT_QUIET_END,
  LODGE_DEFAULT_QUIET_START,
  LODGE_DEFAULT_TIMEZONE,
  LODGE_SAVED_LINKS_CAP,
  type ConversationMemory,
  type LodgeCheckInStep,
  type SavedLink,
} from "./types.js";

export const CHECK_IN_STEPS: LodgeCheckInStep[] = [
  "school",
  "course_page",
  "events_page",
  "roles",
  "done",
];

const SCHOOL_TIMEZONES: Array<[RegExp, string]> = [
  [/\b(?:dubai|nyuad|nyu abu dhabi|aus\b|sharjah|abu dhabi|al ain)\b/i, "Asia/Dubai"],
  [/\b(?:london|ucl|lse|imperial|oxford|cambridge|uk)\b/i, "Europe/London"],
  [/\b(?:stanford|berkeley|ucla|usc|pacific|california)\b/i, "America/Los_Angeles"],
  [/\b(?:new york|columbia|princeton|yale|boston|nyu)\b/i, "America/New_York"],
  [/\b(?:chicago|northwestern)\b/i, "America/Chicago"],
  [/\b(?:singapore|nus|ntu)\b/i, "Asia/Singapore"],
];

export function isSkipText(text: string): boolean {
  return /^(?:skip|none|nope|n\/a|later)$/i.test(text.replace(/\s+/g, " ").trim());
}

export function isCheckInOpen(memory: ConversationMemory | undefined): boolean {
  const step = memory?.checkInStep;
  return Boolean(step && step !== "done");
}

export function checkInPrompt(step: LodgeCheckInStep): string {
  switch (step) {
    case "school":
      return "What’s your school? I use it for local time (default Asia/Dubai). Skip is fine.";
    case "course_page":
      return "Got a public course or syllabus page? Paste the URL, or skip.";
    case "events_page":
      return "Any public events page for campus or societies? Paste it, or skip.";
    case "roles":
      return "Optional: roles + city (internships in Dubai). Skip works. Lodge never applies.";
    case "done":
      return "Lodge is ready. Ask what’s due, what’s on, or send a public link.";
  }
}

export function beginCheckIn(memory: ConversationMemory, now: Date): ConversationMemory {
  return {
    ...memory,
    checkInStep: "school",
    checkInCompletedAt: undefined,
    checkInSkippedAt: undefined,
    timezone: memory.timezone ?? LODGE_DEFAULT_TIMEZONE,
    quietHours: memory.quietHours ?? {
      start: LODGE_DEFAULT_QUIET_START,
      end: LODGE_DEFAULT_QUIET_END,
      enabled: true,
    },
    updatedAt: now.toISOString(),
  };
}

export type CheckInResult =
  | { kind: "consumed"; memory: ConversationMemory; reply: string }
  | { kind: "interrupt"; memory: ConversationMemory };

export function looksLikeCheckInInterrupt(text: string, step: LodgeCheckInStep): boolean {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value || isSkipText(value)) return false;
  if (step === "course_page" || step === "events_page") {
    return extractStudentUrls(value).length === 0 && /[?]/.test(value);
  }
  if (step === "roles") return false;
  return (
    /[?]/.test(value)
    || /^(?:what|who|when|where|why|how|explain|define|find|search|look|remind|note |plan |any )/i.test(value)
    || /^https?:\/\//i.test(value)
  );
}

export function applyCheckInAnswer(
  memory: ConversationMemory,
  rawText: string,
  now: Date,
): CheckInResult {
  const step = memory.checkInStep ?? "done";
  if (step === "done") {
    return { kind: "interrupt", memory };
  }
  const text = rawText.replace(/\s+/g, " ").trim();
  if (looksLikeCheckInInterrupt(text, step)) {
    return {
      kind: "interrupt",
      memory: {
        ...memory,
        checkInStep: "done",
        checkInSkippedAt: memory.checkInSkippedAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
      },
    };
  }

  const skip = isSkipText(text);
  let next = { ...memory, updatedAt: now.toISOString() };

  if (step === "school") {
    if (!skip) {
      next.school = text.slice(0, 120);
      next.timezone = inferTimezone(text) ?? next.timezone ?? LODGE_DEFAULT_TIMEZONE;
    } else {
      next.checkInSkippedAt = now.toISOString();
      next.timezone = next.timezone ?? LODGE_DEFAULT_TIMEZONE;
    }
    next.checkInStep = "course_page";
    return { kind: "consumed", memory: next, reply: checkInPrompt("course_page") };
  }

  if (step === "course_page") {
    if (!skip) {
      const url = firstPublicUrl(text);
      if (url) next = saveLink(next, { kind: "course", url, title: "Course page" }, now);
    } else {
      next.checkInSkippedAt = next.checkInSkippedAt ?? now.toISOString();
    }
    next.checkInStep = "events_page";
    return { kind: "consumed", memory: next, reply: checkInPrompt("events_page") };
  }

  if (step === "events_page") {
    if (!skip) {
      const url = firstPublicUrl(text);
      if (url) next = saveLink(next, { kind: "events", url, title: "Events page" }, now);
    } else {
      next.checkInSkippedAt = next.checkInSkippedAt ?? now.toISOString();
    }
    next.checkInStep = "roles";
    return { kind: "consumed", memory: next, reply: checkInPrompt("roles") };
  }

  if (!skip) {
    const city = extractCity(text);
    if (city) next.rolesCity = city.slice(0, 80);
    next.rolesOptIn = true;
  } else {
    next.checkInSkippedAt = next.checkInSkippedAt ?? now.toISOString();
  }
  next.checkInStep = "done";
  next.checkInCompletedAt = now.toISOString();
  return { kind: "consumed", memory: next, reply: checkInPrompt("done") };
}

export function inferTimezone(school: string): string | undefined {
  const trimmed = school.trim();
  if (isValidTimeZone(trimmed)) return trimmed;
  for (const [pattern, zone] of SCHOOL_TIMEZONES) {
    if (pattern.test(trimmed)) return zone;
  }
  return undefined;
}

export function isValidTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat("en-GB", { timeZone: value }).format(new Date());
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
}

export function firstPublicUrl(text: string): string | undefined {
  for (const url of extractStudentUrls(text)) {
    const guarded = guardPublicUrl(url);
    if (guarded.ok) return guarded.normalized;
  }
  return undefined;
}

export function extractCity(text: string): string {
  const inCity = text.match(/\bin\s+([A-Za-z][A-Za-z .'-]{1,60})$/i);
  if (inCity?.[1]) return inCity[1].trim();
  return text.replace(/^(?:internships?|roles?|openings?|jobs?)\s*/i, "").trim();
}

export function saveLink(
  memory: ConversationMemory,
  input: { kind: SavedLink["kind"]; url: string; title?: string },
  now: Date,
): ConversationMemory {
  const links = [...(memory.savedLinks ?? [])];
  const existing = links.find((link) => link.url === input.url);
  if (existing) {
    existing.kind = input.kind;
    if (input.title) existing.title = input.title;
    return { ...memory, savedLinks: links, updatedAt: now.toISOString() };
  }
  if (links.length >= LODGE_SAVED_LINKS_CAP) return memory;
  links.push({
    id: randomUUID(),
    kind: input.kind,
    url: input.url,
    title: input.title,
    createdAt: now.toISOString(),
  });
  return { ...memory, savedLinks: links, updatedAt: now.toISOString() };
}
