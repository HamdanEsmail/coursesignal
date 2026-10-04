import type { LodgeEvent } from "../lib/calendar.js";

export const FIRSTROLE_URL = "https://firstrole.hamdanesmail12-7a9.workers.dev";

export type TraceStep = {
  endpoint: "search" | "fetch" | "agent";
  label: string;
  studentSees: string;
  detail: string;
  ms: number;
  status: "complete" | "skipped";
};

export type RoleListing = {
  company: string;
  title: string;
  openness: "open" | "unverified";
  reason: string;
  href?: string;
};

export type LodgeFixture = {
  id: "due-week" | "roles-dubai" | "form-walk";
  title: string;
  asked: string;
  summary: string;
  disagreement?: string;
  steps: TraceStep[];
  events: LodgeEvent[];
  roles?: RoleListing[];
};

export const fixtures: LodgeFixture[] = [
  {
    id: "due-week",
    title: "Due this week",
    asked: "what's due this week?",
    summary:
      "Two public dates from a saved course page and its calendar child. Lodge does not pick a winner when they disagree.",
    disagreement:
      "The syllabus says end of week. The calendar child says Friday 17:00. Both stay on the slip, with links.",
    steps: [
      {
        endpoint: "search",
        label: "TinyFish Search",
        studentSees: "Looking it up…",
        detail: "No URL in the text; Search found the saved course page from the notebook.",
        ms: 840,
        status: "complete",
      },
      {
        endpoint: "fetch",
        label: "TinyFish Fetch · course page",
        studentSees: "Reading your page…",
        detail: "Read the saved HTML. Followed one child link labeled calendar.",
        ms: 1120,
        status: "complete",
      },
      {
        endpoint: "fetch",
        label: "TinyFish Fetch · calendar child",
        studentSees: "Reading the calendar…",
        detail: "Second Fetch only. PDF skipped because the HTML already had dates.",
        ms: 960,
        status: "complete",
      },
      {
        endpoint: "agent",
        label: "TinyFish Agent",
        studentSees: "Opening it read-only…",
        detail: "Not started. Both pages were readable HTML.",
        ms: 0,
        status: "skipped",
      },
    ],
    events: [
      {
        title: "Econ problem set",
        start: "2026-10-10T17:00:00",
        end: "2026-10-10T17:00:00",
        where: "Saved page dropbox",
        url: "https://openstax.org/details/books/principles-economics-3e",
        notes: "Calendar child: Friday 17:00. Syllabus: end of week. Lodge kept both.",
      },
      {
        title: "Econ office hours",
        start: "2026-10-09T15:00:00",
        end: "2026-10-09T16:00:00",
        where: "Baker 102",
        url: "https://openstax.org/details/books/principles-economics-3e",
        notes: "Building named on the page, so the slip can carry one maps link.",
      },
    ],
  },
  {
    id: "roles-dubai",
    title: "Roles in Dubai",
    asked: "any internships in Dubai?",
    summary:
      "Lodge texts 1–3 public openings with a still-open badge only where Agent ran. It never applies. FirstRole keeps the full shortlist.",
    steps: [
      {
        endpoint: "search",
        label: "TinyFish Search · query 1",
        studentSees: "Looking it up…",
        detail: "internship Dubai site:.ae careers",
        ms: 780,
        status: "complete",
      },
      {
        endpoint: "search",
        label: "TinyFish Search · query 2",
        studentSees: "Looking it up…",
        detail: "summer internship Dubai 2026",
        ms: 810,
        status: "complete",
      },
      {
        endpoint: "fetch",
        label: "TinyFish Fetch · listing",
        studentSees: "Reading a listing…",
        detail: "Public HTML listing. Company, title, and posted week were on the page.",
        ms: 1040,
        status: "complete",
      },
      {
        endpoint: "fetch",
        label: "TinyFish Fetch · listing",
        studentSees: "Reading a listing…",
        detail: "Second public listing. No portal.",
        ms: 990,
        status: "complete",
      },
      {
        endpoint: "agent",
        label: "TinyFish Agent · one careers page",
        studentSees: "Opening it read-only…",
        detail: "JS careers page. Read-only goal template. Lodge never types or submits.",
        ms: 4200,
        status: "complete",
      },
      {
        endpoint: "fetch",
        label: "TinyFish Fetch · still-open check",
        studentSees: "Checking it is still open…",
        detail: "Verified the Agent URL still served an open posting.",
        ms: 880,
        status: "complete",
      },
    ],
    events: [],
    roles: [
      {
        company: "North Quay Studio",
        title: "Summer internship",
        openness: "open",
        reason: "internship, Dubai, posted this week",
      },
      {
        company: "Municipal Archives",
        title: "Reading-room assistant",
        openness: "open",
        reason: "internship, Dubai, public listing",
      },
      {
        company: "Harbor Press",
        title: "Editorial intern",
        openness: "unverified",
        reason: "internship, Dubai — page was static; Agent did not run",
      },
    ],
  },
  {
    id: "form-walk",
    title: "Form walkthrough",
    asked: "what does this application ask?",
    summary:
      "Read-only Agent lists questions, documents, deadline, and whether the form is still open. Lodge never types, signs in, or submits.",
    steps: [
      {
        endpoint: "fetch",
        label: "TinyFish Fetch · posting",
        studentSees: "Reading the posting…",
        detail: "Public posting named a portal and a Friday deadline.",
        ms: 910,
        status: "complete",
      },
      {
        endpoint: "agent",
        label: "TinyFish Agent · read-only form",
        studentSees: "Opening it read-only…",
        detail: "Goal template: list questions, documents, deadline, still-open. No input.",
        ms: 5100,
        status: "complete",
      },
    ],
    events: [
      {
        title: "Application window closes",
        start: "2026-10-10",
        allDay: true,
        url: "https://openstax.org/details/books/principles-economics-3e",
        notes: "Fixture deadline from a public posting. Lodge did not fill the form.",
      },
    ],
  },
];

export const dueWeekFixture = fixtures[0]!;
export const rolesFixture = fixtures[1]!;
export const formFixture = fixtures[2]!;

export function fixtureById(id: LodgeFixture["id"]): LodgeFixture {
  return fixtures.find((fixture) => fixture.id === id) ?? dueWeekFixture;
}
