import { addPath, slipPath, type LodgeEvent } from "../lib/calendar.js";
import { FIRSTROLE_URL, dueWeekFixture } from "./fixtures.js";

export const DAY_PLAY_MS = 24_000;
export const CHAPTER_PLAY_MS = 3_600;

export type TapKind = "heart" | "up";

export type DayLine =
  | { id: string; kind: "stamp"; text: string }
  | { id: string; kind: "notif"; text: string }
  | { id: string; kind: "you"; text: string }
  | { id: string; kind: "lodge"; text: string }
  | { id: string; kind: "looking"; text: string }
  | { id: string; kind: "slip"; title: string; body: string; href: string }
  | { id: string; kind: "save"; title: string; body: string; href: string }
  | { id: string; kind: "role"; company: string; title: string; open: boolean }
  | { id: string; kind: "tapback"; on: string; tap: TapKind };

export type PhoneFace = "lock" | "messages" | "sleep";

export type DayBeat = {
  id: string;
  say: string;
  title: string;
  rail: string;
  happen: string;
  cue: string;
  clock: string;
  face: PhoneFace;
  lines: DayLine[];
};

export type TimedLine = DayLine & {
  beatId: string;
  at: number;
  until?: number;
};

const weekEvents: LodgeEvent[] = dueWeekFixture.events;
export const daySlipHref = slipPath(weekEvents);
export const daySaveHref = addPath(weekEvents);

export const dayBeats: DayBeat[] = [
  {
    id: "remind",
    say: "Lodge texts first",
    title: "A remind, before you ask.",
    rail: "Morning remind",
    happen: "Lodge texts you in the morning. You did not open an app. Nothing was put on a calendar.",
    cue: "Open a Lodge banner to read it.",
    clock: "8:04",
    face: "lock",
    lines: [
      { id: "n1", kind: "notif", text: "Econ problem set is Friday at five. Want it on a slip?" },
      { id: "n2", kind: "notif", text: "Office hours Thursday, Baker 102." },
      { id: "h-remind", kind: "stamp", text: "Today 8:05 AM" },
      {
        id: "m-remind-in",
        kind: "lodge",
        text: "Econ problem set is Friday at five. Office hours Thursday, Baker 102. I can keep that on a slip if you want.",
      },
    ],
  },
  {
    id: "due",
    say: "what's due this week?",
    title: "You ask what’s due.",
    rail: "What’s due",
    happen: "Text that. Lodge reads the public page you saved. If two dates disagree, both stay on the slip.",
    cue: "Open the slip. Heart it if you want it kept.",
    clock: "10:20",
    face: "messages",
    lines: [
      { id: "h-due", kind: "stamp", text: "Today 10:20 AM" },
      { id: "m-ask", kind: "you", text: "what's due this week?" },
      { id: "m-look-due", kind: "looking", text: "Looking the page up…" },
      {
        id: "m-due",
        kind: "lodge",
        text: "The dates page says Friday 17:00. The syllabus says end of week. I kept both.",
      },
      {
        id: "m-slip",
        kind: "slip",
        title: "This week’s slip",
        body: "Econ problem set · Friday 17:00\nOffice hours · Thursday 15:00 · Baker 102",
        href: daySlipHref,
      },
    ],
  },
  {
    id: "save",
    say: "save the week",
    title: "You approve the week.",
    rail: "Save the week",
    happen: "Lodge never adds a date by itself. Tap Save. Then you choose whether it goes on your calendar.",
    cue: "Tap Save — Lodge never adds the week for you.",
    clock: "1:10",
    face: "messages",
    lines: [
      { id: "h-save", kind: "stamp", text: "Today 1:10 PM" },
      { id: "m-save-ask", kind: "you", text: "save the week" },
      {
        id: "m-save",
        kind: "save",
        title: "Save this week",
        body: "A card opens. You decide. Lodge does not add it for you.",
        href: daySaveHref,
      },
      { id: "m-heart-slip", kind: "tapback", on: "m-slip", tap: "heart" },
      {
        id: "m-saved",
        kind: "lodge",
        text: "Hearted the slip. The week is on your calendar only if you tapped Save.",
      },
    ],
  },
  {
    id: "roles",
    say: "any internships in Dubai?",
    title: "A few internships. Never an application.",
    rail: "A few internships",
    happen: "Lodge checks a few public listings. Heart one to pin it. The longer list lives on FirstRole.",
    cue: "Heart a listing to pin it. Lodge never applies.",
    clock: "4:40",
    face: "messages",
    lines: [
      { id: "h-roles", kind: "stamp", text: "Today 4:40 PM" },
      { id: "m-roles-ask", kind: "you", text: "any internships in Dubai?" },
      { id: "m-look-roles", kind: "looking", text: "Reading a few listings…" },
      {
        id: "m-role-1",
        kind: "role",
        company: "North Quay Studio",
        title: "Summer internship",
        open: true,
      },
      {
        id: "m-role-2",
        kind: "role",
        company: "Municipal Archives",
        title: "Reading-room assistant",
        open: true,
      },
      {
        id: "m-role-3",
        kind: "role",
        company: "Harbor Press",
        title: "Editorial intern",
        open: false,
      },
      { id: "m-heart-role", kind: "tapback", on: "m-role-1", tap: "heart" },
      {
        id: "m-roles-note",
        kind: "lodge",
        text: "Pinned North Quay. I never apply. The longer shortlist is on FirstRole.",
      },
    ],
  },
  {
    id: "note",
    say: "note that office hours moved",
    title: "You pin a fact.",
    rail: "Pin a fact",
    happen: "Text note that… or heart the last list. Lodge keeps it for this chat.",
    cue: "Heart the note if you want Lodge to keep it.",
    clock: "7:15",
    face: "messages",
    lines: [
      { id: "h-note", kind: "stamp", text: "Today 7:15 PM" },
      { id: "m-note", kind: "you", text: "note that office hours moved to Baker 102" },
      { id: "m-noted", kind: "lodge", text: "Pinned. Baker 102 will be on the next slip." },
    ],
  },
  {
    id: "done",
    say: "thumbs-up when it’s done",
    title: "Lodge texts when you asked.",
    rail: "A remind you asked for",
    happen: "A remind you asked for lands at the time you chose. Thumbs-up means done.",
    cue: "Thumbs-up the remind when you have started.",
    clock: "9:00",
    face: "messages",
    lines: [
      { id: "h-done", kind: "stamp", text: "Today 9:00 PM" },
      {
        id: "m-nudge",
        kind: "lodge",
        text: "You asked me to text now. Econ problem set is tomorrow at five. Thumbs-up when you have started.",
      },
      { id: "m-up", kind: "tapback", on: "m-nudge", tap: "up" },
      { id: "m-done", kind: "lodge", text: "Done. I stay quiet after eleven unless you asked to be woken." },
    ],
  },
  {
    id: "quiet",
    say: "quiet hours",
    title: "The lamp goes low.",
    rail: "Quiet hours",
    happen: "Lodge stays out of the night. Tomorrow it can text first again.",
    cue: "Lodge stays quiet unless you asked to be woken.",
    clock: "11:00",
    face: "sleep",
    lines: [],
  },
];

export function firstRoleUrl(): string {
  return FIRSTROLE_URL;
}

export function beatProgress(index: number, beats: DayBeat[] = dayBeats): number {
  if (beats.length <= 1) return 0;
  return Math.min(1, Math.max(0, index / (beats.length - 1)));
}

export function beatIndex(progress: number, beats: DayBeat[] = dayBeats): number {
  let index = 0;
  for (let i = 1; i < beats.length; i++) {
    if (progress + 1e-9 >= beatProgress(i, beats)) index = i;
  }
  return index;
}

export function beatStartProgress(index: number, beats: DayBeat[] = dayBeats): number {
  return beatProgress(index, beats);
}

export function beatEndProgress(index: number, beats: DayBeat[] = dayBeats): number {
  if (index >= beats.length - 1) return 1;
  const last = [...buildTimeline(beats)].reverse().find((line) => line.beatId === beats[index]?.id);
  const ceiling = beatProgress(index + 1, beats) - 0.002;
  if (last) return Math.min(1, Math.max(beatProgress(index, beats), Math.min(ceiling, last.at + 0.002)));
  return Math.max(beatProgress(index, beats), ceiling);
}

export function beatJumpProgress(index: number, beats: DayBeat[] = dayBeats): number {
  return beatEndProgress(index, beats);
}

export function buildTimeline(beats: DayBeat[] = dayBeats): TimedLine[] {
  const timed: TimedLine[] = [];
  beats.forEach((beat, index) => {
    const start = beatProgress(index, beats);
    const end = beatProgress(index + 1, beats);
    const span = Math.max(0.04, end - start);
    const playable = beat.lines.filter((line) => line.kind !== "notif");
    playable.forEach((line, lineIndex) => {
      const local =
        playable.length <= 1 ? 0.2 : 0.1 + 0.7 * (lineIndex / Math.max(1, playable.length - 1));
      timed.push({
        ...line,
        beatId: beat.id,
        at: start + span * local,
      });
    });
  });
  timed.forEach((line, index) => {
    if (line.kind !== "looking") return;
    const next = timed.slice(index + 1).find((item) => item.kind !== "stamp" && item.kind !== "tapback");
    line.until = next ? next.at : line.at + 0.05;
  });
  return timed;
}

export function phoneFace(
  progress: number,
  beats: DayBeat[] = dayBeats,
  timeline: TimedLine[] = buildTimeline(beats),
): PhoneFace {
  const beat = beatAt(progress, beats);
  if (beat.face === "sleep") return "sleep";
  if (beat.face === "lock") {
    const first = timeline.find((line) => line.beatId === beat.id);
    if (!first || progress < first.at) return "lock";
  }
  return "messages";
}

export function playbackKey(progress: number, timeline: TimedLine[] = buildTimeline()): string {
  const ids = [...visibleLineIds(progress, timeline)].join(",");
  return `${beatIndex(progress)}:${phoneFace(progress, dayBeats, timeline)}:${ids}`;
}

export function lockNotes(beats: DayBeat[] = dayBeats): string[] {
  return beats[0]?.lines.filter((line) => line.kind === "notif").map((line) => line.text) ?? [];
}

export function beatAt(progress: number, beats: DayBeat[] = dayBeats): DayBeat {
  return beats[beatIndex(progress, beats)] ?? beats[0]!;
}

export function visibleLineIds(progress: number, timeline: TimedLine[] = buildTimeline()): Set<string> {
  const ids = new Set<string>();
  for (const line of timeline) {
    const on = progress >= line.at && (line.until === undefined || progress < line.until);
    if (on) ids.add(line.id);
  }
  return ids;
}

export function marketingCorpus(): string {
  return JSON.stringify(dayBeats);
}
