export type CourseAction = "add" | "use" | "remove" | "list" | "clear";

export type ParsedCommand =
  | { kind: "echo"; text: string }
  | { kind: "diagnostic"; action: "ping" | "status" | "test" | "health" }
  | { kind: "start" }
  | { kind: "help" }
  | { kind: "sources" }
  | { kind: "plan"; prompt: string }
  | { kind: "watch"; target: string }
  | { kind: "stop" }
  | { kind: "forget"; action: "request" | "confirm" | "cancel" }
  | { kind: "memory" }
  | { kind: "course"; action: CourseAction; name: string }
  | { kind: "research"; prompt: string };

function tailAfter(value: string, prefix: RegExp): string {
  return value.replace(prefix, "").trim();
}

export function parseCommand(input: string): ParsedCommand {
  const value = input.replace(/\s+/g, " ").trim();
  if (/^echo(?:\s|$)/i.test(value)) {
    return { kind: "echo", text: tailAfter(value, /^echo\s*/i) || "ok" };
  }
  if (/^(?:ping|status|test|health)$/i.test(value)) {
    return { kind: "diagnostic", action: value.toLowerCase() as "ping" | "status" | "test" | "health" };
  }
  if (/^start$/i.test(value)) return { kind: "start" };
  if (/^(?:help|commands)$/i.test(value)) return { kind: "help" };
  if (/^sources$/i.test(value)) return { kind: "sources" };
  if (/^plan(?:\s|$)/i.test(value)) {
    return { kind: "plan", prompt: tailAfter(value, /^plan\s*/i) };
  }
  if (/^watch(?:\s|$)/i.test(value)) {
    return { kind: "watch", target: tailAfter(value, /^watch\s*/i) };
  }
  if (/^stop$/i.test(value)) return { kind: "stop" };
  if (/^forget\s+confirm$/i.test(value)) return { kind: "forget", action: "confirm" };
  if (/^forget\s+cancel$/i.test(value)) return { kind: "forget", action: "cancel" };
  if (/^forget$/i.test(value)) return { kind: "forget", action: "request" };
  if (/^memory$/i.test(value)) return { kind: "memory" };

  if (/^courses?$/i.test(value) || /^course\s+list$/i.test(value)) {
    return { kind: "course", action: "list", name: "" };
  }
  if (/^course\s+clear$/i.test(value)) {
    return { kind: "course", action: "clear", name: "" };
  }
  const courseMatch = value.match(/^course(?:\s+(add|use|remove))?\s+(.+)$/i);
  if (courseMatch) {
    const action = (courseMatch[1]?.toLowerCase() ?? "add") as CourseAction;
    return { kind: "course", action, name: courseMatch[2]?.trim() ?? "" };
  }

  return { kind: "research", prompt: value };
}

export function isControlCommand(command: ParsedCommand): boolean {
  return command.kind !== "research";
}
