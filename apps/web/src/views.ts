export const appViews = [
  "start",
  "example",
  "commands",
  "receipt",
  "memory",
  "privacy",
] as const;

export type AppView = (typeof appViews)[number];

const aliases: Record<string, AppView> = {
  "": "start",
  start: "start",
  today: "start",
  connect: "start",
  example: "example",
  commands: "commands",
  receipt: "receipt",
  memory: "memory",
  watches: "memory",
  privacy: "privacy",
};

export function viewFromHash(hash = window.location.hash): AppView {
  const key = hash.replace(/^#/, "").trim().toLowerCase();
  return aliases[key] ?? "start";
}
