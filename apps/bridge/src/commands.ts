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
  | { kind: "forget_note"; text: string }
  | { kind: "memory" }
  | { kind: "course"; action: CourseAction; name: string }
  | { kind: "skip" }
  | { kind: "note"; text: string }
  | { kind: "show_notes" }
  | { kind: "remind"; text: string; when: string }
  | { kind: "snooze"; duration: string }
  | { kind: "whats_due" }
  | { kind: "whats_on" }
  | { kind: "show_trace" }
  | { kind: "applied" }
  | { kind: "save" }
  | { kind: "confirm" }
  | { kind: "find_roles"; query: string; city: string }
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
  if (/^forget\s+note(?:\s|$)/i.test(value)) {
    return { kind: "forget_note", text: tailAfter(value, /^forget\s+note\s*/i) };
  }
  if (/^forget$/i.test(value)) return { kind: "forget", action: "request" };
  if (/^memory$/i.test(value)) return { kind: "memory" };
  if (/^skip$/i.test(value)) return { kind: "skip" };
  if (/^snooze(?:\s|$)/i.test(value)) {
    return { kind: "snooze", duration: tailAfter(value, /^snooze\s*/i) || "1h" };
  }
  if (/^remind(?:\s+me)?(?:\s|$)/i.test(value)) {
    const rest = tailAfter(value, /^remind(?:\s+me)?\s*/i);
    return splitRemind(rest);
  }
  if (/^what'?s\s+due\b/i.test(value) || /^whats\s+due\b/i.test(value)) {
    return { kind: "whats_due" };
  }
  if (/^what'?s\s+on\b/i.test(value) || /^whats\s+on\b/i.test(value)) {
    return { kind: "whats_on" };
  }
  if (/^(?:show[_\s-]?trace|how did you get that)\??$/i.test(value)) {
    return { kind: "show_trace" };
  }
  if (/^(?:show\s+notes|notebook|notes)$/i.test(value)) {
    return { kind: "show_notes" };
  }
  if (/^note(?:\s+that)?(?:\s|$)/i.test(value)) {
    return { kind: "note", text: tailAfter(value, /^note(?:\s+that)?\s*/i) };
  }
  if (/^i applied$/i.test(value)) return { kind: "applied" };
  if (/^save(?:\s+this)?$/i.test(value)) return { kind: "save" };
  if (/^(?:yes|yep|confirm|yes please)$/i.test(value)) return { kind: "confirm" };

  const internship = value.match(
    /^(?:any\s+|find\s+)?(?:internships?|roles?|openings?)(?:\s+in\s+(.+?))?\??$/i,
  );
  if (internship) {
    return {
      kind: "find_roles",
      query: "internship",
      city: (internship[1] ?? "").trim(),
    };
  }

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

function splitRemind(rest: string): { kind: "remind"; text: string; when: string } {
  if (!rest) return { kind: "remind", text: "Reminder", when: "in 5 minutes" };
  const inMatch = rest.match(/^(?:to\s+)?(.+?)\s+(in\s+.+)$/i);
  if (inMatch?.[1] && inMatch[2]) {
    return { kind: "remind", text: inMatch[1].replace(/^to\s+/i, "").trim() || "Reminder", when: inMatch[2].trim() };
  }
  const atMatch = rest.match(/^(?:to\s+)?(.+?)\s+(at\s+.+)$/i);
  if (atMatch?.[1] && atMatch[2]) {
    return { kind: "remind", text: atMatch[1].replace(/^to\s+/i, "").trim() || "Reminder", when: atMatch[2].trim() };
  }
  if (/^(?:in|at)\s+/i.test(rest) || /^\d+\s*(?:m|min|minutes?|h|hrs?|hours?)$/i.test(rest)) {
    return { kind: "remind", text: "Reminder", when: rest };
  }
  return { kind: "remind", text: rest.replace(/^to\s+/i, "").trim() || "Reminder", when: "in 5 minutes" };
}
