import { randomUUID } from "node:crypto";
import {
  LODGE_NOTEBOOK_CAP,
  type ConversationMemory,
  type DeadlineNote,
  type EventNote,
  type EvidenceSource,
  type NotebookNote,
  type NotebookNoteKind,
  type OpportunityNote,
  type PendingReminder,
} from "./types.js";

export function notesOf(memory: ConversationMemory | undefined): NotebookNote[] {
  return [...(memory?.notebook ?? [])];
}

export function showNotes(memory: ConversationMemory | undefined): string {
  const notes = notesOf(memory);
  if (notes.length === 0) {
    return "Notebook is empty. Heart a list to pin it, or text note that …";
  }
  const lines = notes.slice(-12).map((note, index) => formatNote(index + 1, note));
  const extra = notes.length > 12 ? `\n…${notes.length - 12} older` : "";
  return `Notebook (${notes.length}/${LODGE_NOTEBOOK_CAP})\n${lines.join("\n")}${extra}`;
}

export function addNote(
  memory: ConversationMemory,
  input: {
    text: string;
    kind?: NotebookNoteKind;
    url?: string;
    dueAt?: string;
    startsAt?: string;
    endsAt?: string;
    where?: string;
    company?: string;
    listingTitle?: string;
  },
  now: Date,
): { ok: true; memory: ConversationMemory; note: NotebookNote } | { ok: false; reason: "empty" | "full" } {
  const text = input.text.replace(/\s+/g, " ").trim().slice(0, 400);
  if (!text) return { ok: false, reason: "empty" };
  const notebook = notesOf(memory);
  if (notebook.length >= LODGE_NOTEBOOK_CAP) return { ok: false, reason: "full" };
  const createdAt = now.toISOString();
  const kind = input.kind ?? inferNoteKind(text);
  const base = { id: randomUUID(), text, createdAt, url: input.url };
  let note: NotebookNote;
  if (kind === "deadline") {
    note = { ...base, kind: "deadline", dueAt: input.dueAt } satisfies DeadlineNote;
  } else if (kind === "event") {
    note = {
      ...base,
      kind: "event",
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      where: input.where,
    } satisfies EventNote;
  } else if (kind === "opportunity") {
    note = {
      ...base,
      kind: "opportunity",
      company: input.company,
      listingTitle: input.listingTitle ?? text,
      applied: false,
    } satisfies OpportunityNote;
  } else if (kind === "reminder") {
    note = { ...base, kind: "reminder", remindAt: input.dueAt };
  } else {
    note = { ...base, kind: "freeform" };
  }
  return {
    ok: true,
    memory: { ...memory, notebook: [...notebook, note], updatedAt: createdAt },
    note,
  };
}

export function forgetNote(
  memory: ConversationMemory,
  query: string | undefined,
): { ok: true; memory: ConversationMemory; removed: NotebookNote } | { ok: false; reason: "empty" | "missing" } {
  const notebook = notesOf(memory);
  if (notebook.length === 0) return { ok: false, reason: "empty" };
  const needle = query?.replace(/\s+/g, " ").trim().toLowerCase();
  const index = needle
    ? notebook.findLastIndex((note) =>
      note.text.toLowerCase().includes(needle)
      || (note.kind === "opportunity" && (note.listingTitle?.toLowerCase().includes(needle) || note.company?.toLowerCase().includes(needle)))
    )
    : notebook.length - 1;
  if (index < 0) return { ok: false, reason: "missing" };
  const removed = notebook[index]!;
  const next = notebook.filter((_, item) => item !== index);
  return {
    ok: true,
    memory: { ...memory, notebook: next, updatedAt: memory.updatedAt },
    removed,
  };
}

export function pinSources(
  memory: ConversationMemory,
  sources: EvidenceSource[],
  now: Date,
): { memory: ConversationMemory; pinned: number; full: boolean } {
  let next = memory;
  let pinned = 0;
  let full = false;
  for (const source of sources.slice(0, 5)) {
    const added = addNote(next, {
      text: source.title || source.excerpt.slice(0, 120) || source.url,
      url: source.url,
      kind: "freeform",
    }, now);
    if (!added.ok) {
      full = added.reason === "full";
      break;
    }
    next = added.memory;
    pinned += 1;
  }
  return { memory: next, pinned, full };
}

export function pinOpportunity(
  memory: ConversationMemory,
  listing: { company?: string; title: string; url?: string },
  now: Date,
): ReturnType<typeof addNote> {
  return addNote(memory, {
    text: listing.company ? `${listing.company} — ${listing.title}` : listing.title,
    kind: "opportunity",
    url: listing.url,
    company: listing.company,
    listingTitle: listing.title,
  }, now);
}

export function markLastOpportunityApplied(
  memory: ConversationMemory,
  now: Date,
): { ok: true; memory: ConversationMemory; note: OpportunityNote } | { ok: false } {
  const notebook = notesOf(memory);
  const index = notebook.findLastIndex((note) => note.kind === "opportunity");
  if (index < 0) return { ok: false };
  const current = notebook[index] as OpportunityNote;
  const note: OpportunityNote = {
    ...current,
    applied: true,
    appliedAt: now.toISOString(),
  };
  const next = [...notebook];
  next[index] = note;
  return { ok: true, memory: { ...memory, notebook: next, updatedAt: now.toISOString() }, note };
}

export function markReminderDone(
  memory: ConversationMemory,
  now: Date,
): { ok: true; memory: ConversationMemory; reminder: PendingReminder } | { ok: false } {
  const reminders = [...(memory.pendingReminders ?? [])];
  const index = reminders.findLastIndex((item) =>
    item.status === "fired" || item.status === "scheduled" || item.status === "snoozed"
  );
  if (index < 0) return { ok: false };
  const reminder = { ...reminders[index]!, status: "done" as const };
  reminders[index] = reminder;
  return {
    ok: true,
    memory: { ...memory, pendingReminders: reminders, updatedAt: now.toISOString() },
    reminder,
  };
}

export function clashLine(
  memory: ConversationMemory,
  input: { title: string; start: string; end: string },
): string | undefined {
  const start = Date.parse(input.start);
  const end = Date.parse(input.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined;
  for (const note of notesOf(memory)) {
    const range = noteRange(note);
    if (!range) continue;
    if (start < range.end && end > range.start) {
      return `${input.title} overlaps ${note.text.slice(0, 80)}.`;
    }
  }
  return undefined;
}

export function weekEvents(memory: ConversationMemory, now: Date): Array<{
  title: string;
  start: string;
  end: string;
  location?: string;
  url?: string;
}> {
  const from = now.getTime();
  const to = from + 7 * 24 * 60 * 60 * 1_000;
  const events: Array<{ title: string; start: string; end: string; location?: string; url?: string }> = [];
  for (const note of notesOf(memory)) {
    const range = noteRange(note);
    if (!range) continue;
    if (range.start < from || range.start > to) continue;
    events.push({
      title: note.text.slice(0, 120),
      start: new Date(range.start).toISOString(),
      end: new Date(range.end).toISOString(),
      location: note.kind === "event" ? note.where : undefined,
      url: note.url,
    });
  }
  return events;
}

function inferNoteKind(text: string): NotebookNoteKind {
  if (/\b(?:internship|intern|role|opening|job)\b/i.test(text)) return "opportunity";
  if (/\b(?:due|deadline)\b/i.test(text)) return "deadline";
  if (/\b(?:event|office hours|clinic|talk|workshop)\b/i.test(text)) return "event";
  if (/\bremind/i.test(text)) return "reminder";
  return "freeform";
}

function formatNote(index: number, note: NotebookNote): string {
  const flag = note.kind === "opportunity" && note.applied ? "applied" : note.kind;
  return `${index}. [${flag}] ${note.text}`;
}

function noteRange(note: NotebookNote): { start: number; end: number } | undefined {
  if (note.kind === "event" && note.startsAt) {
    const start = Date.parse(note.startsAt);
    const end = Date.parse(note.endsAt ?? note.startsAt) + (note.endsAt ? 0 : 60 * 60 * 1_000);
    if (Number.isFinite(start) && Number.isFinite(end)) return { start, end };
  }
  if (note.kind === "deadline" && note.dueAt) {
    const start = Date.parse(note.dueAt);
    if (Number.isFinite(start)) return { start, end: start + 60 * 60 * 1_000 };
  }
  if (note.kind === "reminder" && note.remindAt) {
    const start = Date.parse(note.remindAt);
    if (Number.isFinite(start)) return { start, end: start + 15 * 60 * 1_000 };
  }
  return undefined;
}
