import { LODGE_DEFAULT_TIMEZONE } from "./types.js";

export type GroundedClaimKind = "date" | "time" | "still_open";

export type CitedToolResult = {
  traceId: string;
  tool: "search" | "fetch" | "agent" | "other";
  url?: string;
  title?: string;
  text: string;
};

export type SourceDisagreement = {
  kind: GroundedClaimKind;
  left: { value: string; citation: CitedToolResult };
  right: { value: string; citation: CitedToolResult };
};

export type ExtractedClaim = {
  kind: GroundedClaimKind;
  value: string;
  normalized: string;
};

export type GroundingResult = {
  text: string;
  hedged: boolean;
  hedges: string[];
  disagreements: SourceDisagreement[];
  citations: CitedToolResult[];
};

const MONTHS =
  "january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

const DATE_PATTERN = new RegExp(
  String.raw`\b(?:20\d{2}-\d{2}-\d{2}|(?:${MONTHS})\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*20\d{2})?|\d{1,2}(?:st|nd|rd|th)?\s+(?:${MONTHS})(?:\s+20\d{2})?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|eow|eod|end of (?:the )?week|end of (?:the )?day)\b`,
  "gi",
);

const TIME_PATTERN =
  /\b(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*(?:a\.?m\.?|p\.?m\.?))?|\b(?:[1-9]|1[0-2])\s*(?:a\.?m\.?|p\.?m\.?)|\b\d{1,2}\s*hours\b/gi;

const STILL_OPEN_PATTERN =
  /\bstill[\s-]open\b|\bno longer (?:open|accepting(?: applications)?)\b|\bapplications? (?:are )?(?:now )?(?:open|closed)\b|\b(?:listing|form|role) (?:is )?(?:still )?(?:open|closed)\b|\bstatus:\s*(?:open|closed|unverified)\b|\b(?:currently )?(?:open|closed) for applications\b/gi;

const DEADLINE_HINT = /\b(?:due|deadline|close[sd]?|submit|eow|eod|end of)\b/i;

const HEDGE: Record<GroundedClaimKind, string> = {
  date: "I couldn't confirm that date on a checked page.",
  time: "I couldn't confirm that time on a checked page.",
  still_open: "I couldn't confirm whether it's still open from a checked page.",
};

/** Stable per-turn citation ids, 1-based (`T1`, `T2`, …). */
export function createTraceId(index: number): string {
  if (!Number.isInteger(index) || index < 1) {
    throw new Error("Trace ids are 1-based integers.");
  }
  return `T${index}`;
}

export function extractClaims(text: string): ExtractedClaim[] {
  const claims: ExtractedClaim[] = [];
  const seen = new Set<string>();
  for (const [kind, pattern] of [
    ["date", DATE_PATTERN],
    ["time", TIME_PATTERN],
    ["still_open", STILL_OPEN_PATTERN],
  ] as const) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const value = compactWhitespace(match[0] ?? "");
      if (!value) continue;
      const normalized = canonicalClaim(kind, value);
      const key = `${kind}:${normalized}`;
      if (seen.has(key)) continue;
      seen.add(key);
      claims.push({ kind, value, normalized });
    }
  }
  return claims;
}

export function claimIsCited(claim: ExtractedClaim, citations: CitedToolResult[]): boolean {
  return citations.some((citation) => appearsIn(claim, citation.text));
}

export function findSourceDisagreements(citations: CitedToolResult[]): SourceDisagreement[] {
  const disagreements: SourceDisagreement[] = [];
  const deadlineDates = citations
    .map((citation) => ({
      citation,
      values: DEADLINE_HINT.test(citation.text)
        ? unique(extractClaims(citation.text).filter((claim) => claim.kind === "date").map((claim) => claim.normalized))
        : [],
    }))
    .filter((entry) => entry.values.length > 0);

  for (let i = 0; i < deadlineDates.length; i += 1) {
    for (let j = i + 1; j < deadlineDates.length; j += 1) {
      const left = deadlineDates[i]!;
      const right = deadlineDates[j]!;
      const leftOnly = left.values.filter((value) => !right.values.includes(value));
      const rightOnly = right.values.filter((value) => !left.values.includes(value));
      if (leftOnly.length === 0 || rightOnly.length === 0) continue;
      disagreements.push({
        kind: "date",
        left: { value: leftOnly[0]!, citation: left.citation },
        right: { value: rightOnly[0]!, citation: right.citation },
      });
    }
  }

  const stillOpen = citations
    .map((citation) => ({ citation, status: stillOpenStatus(citation.text) }))
    .filter((entry): entry is { citation: CitedToolResult; status: "open" | "closed" } =>
      entry.status === "open" || entry.status === "closed"
    );
  for (let i = 0; i < stillOpen.length; i += 1) {
    for (let j = i + 1; j < stillOpen.length; j += 1) {
      const left = stillOpen[i]!;
      const right = stillOpen[j]!;
      if (left.status === right.status) continue;
      disagreements.push({
        kind: "still_open",
        left: { value: left.status, citation: left.citation },
        right: { value: right.status, citation: right.citation },
      });
    }
  }

  return disagreements;
}

export function formatDisagreement(disagreement: SourceDisagreement): string {
  return [
    `The ${sourceLabel(disagreement.left.citation)} says ${disagreement.left.value}${sourcePointer(disagreement.left.citation)}.`,
    `The ${sourceLabel(disagreement.right.citation)} says ${disagreement.right.value}${sourcePointer(disagreement.right.citation)}.`,
    "I have not picked a winner.",
  ].join(" ");
}

/**
 * Dates, times, and still-open status must appear in a cited tool result.
 * Otherwise the reply is hedged. Disagreeing sources are both reported.
 */
export function groundReply(
  reply: string,
  citations: CitedToolResult[],
  _options?: { timeZone?: string; now?: Date },
): GroundingResult {
  const text = compactWhitespace(reply);
  const hedges: string[] = [];
  for (const claim of extractClaims(text)) {
    if (claimIsCited(claim, citations)) continue;
    const hedge = HEDGE[claim.kind];
    if (!hedges.includes(hedge) && !includesIgnoreCase(text, hedge)) hedges.push(hedge);
  }

  const disagreements = findSourceDisagreements(citations);
  const parts = text ? [text] : [];
  if (!includesIgnoreCase(text, "I have not picked a winner.")) {
    for (const disagreement of disagreements) parts.push(formatDisagreement(disagreement));
  }
  parts.push(...hedges);

  return {
    text: compactWhitespace(parts.join(" ")),
    hedged: hedges.length > 0,
    hedges,
    disagreements,
    citations,
  };
}

export function formatHumanLocalTime(
  iso: string,
  timeZone = LODGE_DEFAULT_TIMEZONE,
  now = new Date(),
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const clock = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(date);
  const today = zonedYmd(now, timeZone);
  const target = zonedYmd(date, timeZone);
  if (target === today) return `Today, ${clock}`;
  if (target === zonedYmd(new Date(now.getTime() + 24 * 60 * 60 * 1_000), timeZone)) {
    return `Tomorrow, ${clock}`;
  }
  const weekday = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone,
  }).format(date);
  return `${weekday}, ${clock}`;
}

function appearsIn(claim: ExtractedClaim, text: string): boolean {
  const hay = normalizeHaystack(text);
  if (hay.includes(claim.normalized)) return true;
  if (claim.kind === "date") {
    if (claim.normalized === "eow" && /\bend of (?:the )?week\b/.test(hay)) return true;
    if (claim.normalized === "end of week" && /\beow\b/.test(hay)) return true;
    if (claim.normalized === "eod" && /\bend of (?:the )?day\b/.test(hay)) return true;
    if (claim.normalized === "end of day" && /\beod\b/.test(hay)) return true;
  }
  if (claim.kind === "still_open") {
    const status = stillOpenStatus(claim.value);
    const cited = stillOpenStatus(text);
    return status !== undefined && status === cited;
  }
  return false;
}

function stillOpenStatus(text: string): "open" | "closed" | "unverified" | undefined {
  const hay = normalizeHaystack(text);
  if (/\bno longer (?:open|accepting)/.test(hay) || /\b(?:applications?|listing|form|role) (?:are |is )?(?:now )?closed\b/.test(hay) || /\bclosed for applications\b/.test(hay) || /\bstatus: closed\b/.test(hay)) {
    return "closed";
  }
  if (/\bstill(?:\s|-)open\b/.test(hay) || /\b(?:applications?|listing|form|role) (?:are |is )?(?:now )?open\b/.test(hay) || /\bopen for applications\b/.test(hay) || /\bstatus: open\b/.test(hay)) {
    return "open";
  }
  if (/\bstatus: unverified\b/.test(hay)) return "unverified";
  return undefined;
}

function canonicalClaim(kind: GroundedClaimKind, value: string): string {
  const normalized = normalizeHaystack(value);
  if (kind === "date") {
    if (normalized === "eow" || normalized === "end of the week") return "end of week";
    if (normalized === "eod" || normalized === "end of the day") return "end of day";
  }
  if (kind === "still_open") return stillOpenStatus(value) ?? normalized;
  return normalized;
}

function sourceLabel(citation: CitedToolResult): string {
  return citation.title?.trim() || "source";
}

function sourcePointer(citation: CitedToolResult): string {
  if (citation.url) return ` (${citation.url})`;
  return ` (${citation.traceId})`;
}

function zonedYmd(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function normalizeHaystack(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function includesIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
