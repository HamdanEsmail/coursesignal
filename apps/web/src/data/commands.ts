export type CommandRow = {
  command: string;
  when: string;
  example: string;
};

/** Crib sheet quoted from the live bridge HELP / consent flow in apps/bridge/src/handler.ts. */
export const commandRows: CommandRow[] = [
  {
    command: "START",
    when: "First message, or after you erased memory. CourseSignal will not research until you send this.",
    example: "START",
  },
  {
    command: "HELP",
    when: "You want the full command list in the chat.",
    example: "HELP",
  },
  {
    command: "COURSE",
    when: "Optionally remember a course so later questions stay in that context.",
    example: "COURSE STAT 210",
  },
  {
    command: "COURSE LIST",
    when: "See the course names this chat remembers.",
    example: "COURSE LIST",
  },
  {
    command: "COURSE USE",
    when: "Switch which remembered course is active.",
    example: "COURSE USE STAT 210",
  },
  {
    command: "COURSE REMOVE",
    when: "Drop one course name without erasing the rest of the chat.",
    example: "COURSE REMOVE STAT 210",
  },
  {
    command: "SOURCES",
    when: "After an answer, open the latest evidence receipt in the thread.",
    example: "SOURCES",
  },
  {
    command: "PLAN",
    when: "Ask for a source-linked study plan. Add a goal, or it will use the last topic.",
    example: "PLAN prepare for Thursday’s probability quiz",
  },
  {
    command: "WATCH",
    when: "Opt in to a quiet change watch on a public source or the last result.",
    example: "WATCH",
  },
  {
    command: "STOP",
    when: "Pause every proactive watch. You can still ask questions.",
    example: "STOP",
  },
  {
    command: "MEMORY",
    when: "See what this chat currently remembers.",
    example: "MEMORY",
  },
  {
    command: "EXAMPLE",
    when: "Look again for a worked problem on the last topic. A short follow-up such as “give me an example” does the same.",
    example: "EXAMPLE",
  },
  {
    command: "FORGET",
    when: "Begin erasing this chat’s memory, consent, watches, and latest receipt.",
    example: "FORGET",
  },
  {
    command: "FORGET CONFIRM",
    when: "Finish deletion within ten minutes of FORGET. Or send FORGET CANCEL.",
    example: "FORGET CONFIRM",
  },
];

export const everydayAskHint =
  "Ask in ordinary words — a concept, campus service, textbook, scholarship, opportunity, or deadline. A public syllabus URL is fine. Do not send passwords, student IDs, or private LMS links.";

export const starterCommands = ["START", "HELP", "COURSE", "SOURCES", "PLAN", "WATCH", "FORGET"] as const;
