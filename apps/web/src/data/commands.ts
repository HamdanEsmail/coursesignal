export type CommandRow = {
  command: string;
  when: string;
  example: string;
};

export const commandRows: CommandRow[] = [
  {
    command: "START",
    when: "First text, or after you erased the notebook. Lodge waits here before it looks anything up.",
    example: "START",
  },
  {
    command: "skip",
    when: "A check-in question is optional. School, course page, events page, roles and city can all be skipped.",
    example: "skip",
  },
  {
    command: "HELP",
    when: "You want the short list in the thread.",
    example: "HELP",
  },
  {
    command: "what's due",
    when: "Lodge Fetches the saved course page and follows at most two child links for dates.",
    example: "what's due this week",
  },
  {
    command: "what's on",
    when: "Same desk, campus or society events page instead of a syllabus.",
    example: "what's on Friday",
  },
  {
    command: "remind me",
    when: "Lodge confirms a clock time in your timezone, then texts first. 👍 is done. You-asked reminders ignore quiet hours.",
    example: "remind me in 5 minutes",
  },
  {
    command: "snooze 1h",
    when: "Push a reminder you already asked for.",
    example: "snooze 1h",
  },
  {
    command: "note that",
    when: "Pin a fact into the notebook. A heart on the last list does the same. Cap is about thirty lines.",
    example: "note that office hours moved to Baker 102",
  },
  {
    command: "any internships",
    when: "Lodge searches public listings, Fetches a few, and may open one careers page read-only. You get 1–3 lines, never an application.",
    example: "any internships in Dubai?",
  },
  {
    command: "I applied",
    when: "Mark a pinned opening as applied. That is the whole tracker. The full shortlist lives on FirstRole.",
    example: "I applied",
  },
  {
    command: "how did you get that?",
    when: "The ledger: tool, URL, time, checked-live versus own-knowledge, named failures.",
    example: "how did you get that?",
  },
  {
    command: "FORGET",
    when: "Begin erasing this chat’s notebook, reminders, saved pages, and consent.",
    example: "FORGET",
  },
  {
    command: "FORGET CONFIRM",
    when: "Finish deletion after FORGET. Or send FORGET CANCEL.",
    example: "FORGET CONFIRM",
  },
];

export const everydayAskHint =
  "Ask in ordinary words — a deadline, a public course page, a poster photo, a building name, or internships in a city. Paste a public link and Lodge offers to save it. Keep passwords, student IDs, and private school logins out of the thread.";

export const starterCommands = [
  "START",
  "skip",
  "what's due",
  "remind me",
  "note that",
  "how did you get that?",
  "FORGET",
] as const;
