import { signalSchema, type Signal } from "@coursesignal/contracts";

const checkedAt = "2026-10-02T18:53:17.000Z";

const sample: Signal = {
  id: "demo-stat-210-conditional-2026-10-02",
  course: "STAT 210",
  title: "Conditional probability",
  question: "What is conditional probability in statistics?",
  answer:
    "Conditional probability is the chance of B once you already know A happened. If 23% of days in a city are rainy, P(R)=0.23. After you learn the day is cloudy, you want P(R|C)—rain inside that smaller set of cloudy days.",
  actions: [
    {
      id: "action-define",
      title: "Keep the sample space smaller",
      detail:
        "Once A has occurred, only the outcomes inside A still count. P(B|A) asks how often B is true among those remaining outcomes.",
      sourceLabel: "Pishro-Nik · Introduction to Probability",
    },
    {
      id: "action-example",
      title: "Use the rainy-day numbers",
      detail:
        "Public notes set P(R)=0.23 for a random day. Learning that the day is cloudy replaces that with P(R|C), not another guess.",
      sourceLabel: "Pishro-Nik · Conditional probability",
    },
    {
      id: "action-next",
      title: "Stay in the same thread",
      detail:
        "A short follow-up such as “give me an example” stays on this topic. SOURCES shows the pages; PLAN builds a study path from them.",
      sourceLabel: "CourseSignal thread",
    },
  ],
  claims: [
    {
      id: "claim-definition",
      statement:
        "Conditional probability is the chance of an event after extra information is known.",
      state: "verified",
      sourceIds: ["source-pishro", "source-openstax"],
      observedAt: checkedAt,
    },
    {
      id: "claim-numeric",
      statement:
        "If 23% of days are rainy, the unconditional rain chance is P(R)=0.23; extra information would replace that with a conditional value.",
      state: "verified",
      sourceIds: ["source-pishro"],
      observedAt: checkedAt,
    },
    {
      id: "claim-exam",
      statement:
        "Public notes do not say which wording an instructor will use on a quiz.",
      state: "unknown",
      sourceIds: [],
      observedAt: checkedAt,
    },
  ],
  sources: [
    {
      id: "source-pishro",
      title: "Conditional Probability",
      publisher: "Hossein Pishro-Nik, Introduction to Probability",
      url: "https://www.probabilitycourse.com/chapter1/1_4_0_conditional_probability.php",
      checkedAt,
      endpoint: "fetch",
    },
    {
      id: "source-openstax",
      title: "Introductory Statistics — probability topics",
      publisher: "OpenStax",
      url: "https://openstax.org/details/books/introductory-statistics-2e",
      checkedAt,
      endpoint: "fetch",
    },
  ],
  stages: [
    {
      endpoint: "search",
      label: "TinyFish Search found public notes",
      detail: "Ranked an open probability text above homework-mill lesson pages.",
      status: "complete",
      observedAt: "2026-10-02T18:52:46.000Z",
    },
    {
      endpoint: "fetch",
      label: "TinyFish Fetch read the pages",
      detail: "Kept the definition and the numeric rainy-day problem; skipped unread IP PDFs.",
      status: "complete",
      observedAt: checkedAt,
    },
    {
      endpoint: "agent",
      label: "Interactive catalogue not needed",
      detail: "The pages were readable, so TinyFish Agent was not started.",
      status: "waiting",
    },
  ],
  createdAt: "2026-10-02T18:52:45.000Z",
  checkedAt,
  watchState: "off",
};

export const sampleSignal = signalSchema.parse(sample);

export type DemoBubble =
  | { role: "student"; text: string }
  | { role: "ack"; text: string }
  | { role: "signal"; text: string };

/** Fixture thread that shows the iMessage product, not a second chatbot. */
export const demoThread: DemoBubble[] = [
  { role: "student", text: "What is conditional probability in statistics?" },
  { role: "ack", text: "Checking public sources for that now." },
  {
    role: "signal",
    text: "Conditional probability is the chance of B once you already know A happened. Notes write that as P(B|A).",
  },
  { role: "student", text: "Give me an explainable example?" },
  { role: "ack", text: "Checking public sources for that now." },
  {
    role: "signal",
    text: "If 23% of days in a city are rainy, P(R)=0.23. After you learn the day is cloudy, you want P(R|C)—rain inside that smaller set of cloudy days.",
  },
];
