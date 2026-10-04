export const landingSections = [
  { id: "arrive", label: "Lodge" },
  { id: "demo", label: "On iMessage" },
  { id: "roles", label: "Roles" },
  { id: "start", label: "Start" },
  { id: "rules", label: "House rules" },
  { id: "judge", label: "For reviewers" },
] as const;

export type AppView = (typeof landingSections)[number]["id"];

const aliases: Record<string, AppView> = {
  "": "arrive",
  arrive: "arrive",
  day: "arrive",
  wednesday: "arrive",
  start: "start",
  today: "arrive",
  connect: "start",
  run: "demo",
  "a-run": "demo",
  arun: "demo",
  example: "demo",
  demo: "demo",
  text: "start",
  commands: "start",
  what: "start",
  desk: "start",
  memory: "start",
  watches: "start",
  roles: "roles",
  rules: "rules",
  privacy: "rules",
  house: "rules",
  judge: "judge",
  receipt: "judge",
  sources: "judge",
};

export function viewFromHash(hash = window.location.hash): AppView {
  const key = hash.replace(/^#/, "").trim().toLowerCase();
  return aliases[key] ?? "arrive";
}
