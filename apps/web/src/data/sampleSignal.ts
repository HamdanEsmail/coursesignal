import { signalSchema, type Signal } from "@coursesignal/contracts";

const sample: Signal = {
  id: "demo-stat-210-2026-10-01",
  course: "STAT 210",
  title: "Tonight's signal",
  question: "What should I focus on tonight?",
  answer:
    "Here is a focused plan based on the supplied demo syllabus and the current unit. Each step links to a source.",
  actions: [
    {
      id: "action-core",
      title: "Review Unit 3 core concepts",
      detail:
        "Focus on discrete and continuous random variables, expected value, and variance. Work through the examples before attempting the exercises.",
      sourceLabel: "Demo syllabus · Unit 3",
    },
    {
      id: "action-practice",
      title: "Practice expectation and variance",
      detail:
        "Complete exercises 4.1, 4.3, and 4.4, then explain why each formula applies in one sentence.",
      sourceLabel: "OpenStax · Chapter 4",
    },
    {
      id: "action-preview",
      title: "Preview common distributions",
      detail:
        "Skim the binomial and normal distribution sections so the next lecture starts with familiar language.",
      sourceLabel: "Demo syllabus · Week 6",
    },
  ],
  claims: [
    {
      id: "claim-topics",
      statement:
        "Unit 3 covers discrete and continuous random variables, expected value, and variance.",
      state: "verified",
      sourceIds: ["source-syllabus"],
      observedAt: "2026-10-01T14:15:00.000Z",
    },
    {
      id: "claim-practice",
      statement: "Exercises 4.1, 4.3, and 4.4 match the current unit topics.",
      state: "inferred",
      sourceIds: ["source-openstax"],
      observedAt: "2026-10-01T14:16:00.000Z",
    },
    {
      id: "claim-emphasis",
      statement:
        "The available public sources do not reveal which problem types the instructor will emphasize.",
      state: "unknown",
      sourceIds: [],
      observedAt: "2026-10-01T14:16:00.000Z",
    },
  ],
  sources: [
    {
      id: "source-syllabus",
      title: "STAT 210 demonstration syllabus",
      publisher: "Synthetic course fixture",
      url: "https://example.edu/stat210/syllabus",
      checkedAt: "2026-10-01T14:15:00.000Z",
      endpoint: "fetch",
    },
    {
      id: "source-openstax",
      title: "Introductory Statistics — probability topics",
      publisher: "OpenStax",
      url: "https://openstax.org/details/books/introductory-statistics-2e",
      checkedAt: "2026-10-01T14:16:00.000Z",
      endpoint: "fetch",
    },
  ],
  stages: [
    {
      endpoint: "search",
      label: "Found authoritative sources",
      detail: "Prioritized the supplied course source and an open textbook.",
      status: "complete",
      observedAt: "2026-10-01T14:15:00.000Z",
    },
    {
      endpoint: "fetch",
      label: "Read the source material",
      detail: "Extracted the current topics and supporting passages.",
      status: "complete",
      observedAt: "2026-10-01T14:15:30.000Z",
    },
    {
      endpoint: "agent",
      label: "Interactive catalogue not needed",
      detail: "The demo sources were directly readable, so no paid Agent run was started.",
      status: "waiting",
    },
  ],
  createdAt: "2026-10-01T14:14:00.000Z",
  checkedAt: "2026-10-01T14:16:00.000Z",
  watchState: "active",
};

export const sampleSignal = signalSchema.parse(sample);
