export const cubbies = [
  { id: "arrive", label: "Arrive" },
  { id: "run", label: "A run" },
  { id: "demo", label: "#demo" },
  { id: "text", label: "What to text" },
  { id: "desk", label: "The desk" },
  { id: "roles", label: "Roles" },
  { id: "rules", label: "House rules" },
  { id: "judge", label: "#judge" },
] as const;

export type AppView = (typeof cubbies)[number]["id"];

const aliases: Record<string, AppView> = {
  "": "arrive",
  arrive: "arrive",
  start: "arrive",
  today: "arrive",
  connect: "arrive",
  run: "run",
  "a-run": "run",
  arun: "run",
  example: "run",
  demo: "demo",
  text: "text",
  commands: "text",
  what: "text",
  desk: "desk",
  memory: "desk",
  watches: "desk",
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
