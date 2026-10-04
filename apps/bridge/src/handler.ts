import { randomUUID } from "node:crypto";
import { isControlCommand, parseCommand, type ParsedCommand } from "./commands.js";
import { ConversationCoordinator } from "./coordinator.js";
import { silentLogger } from "./logger.js";
import { cleanReceiptText, createTinyFishResearchService, displaySourceTitle, formatCheckedAt } from "./research.js";
import { InMemoryBridgeStore } from "./store.js";
import type {
  BridgeLogger,
  BridgeStore,
  ConversationMemory,
  ConversationPort,
  InboundEnvelope,
  HandleDisposition,
  ResearchMode,
  ResearchResult,
  ResearchService,
} from "./types.js";

const SAFE_FAILURE_REPLY =
  "I could not verify that request from live sources. I have not guessed or started another paid run. Please try again later.";
const CONSENT_VERSION = 3 as const;
const CONSENT_PROMPT = [
  "Welcome to CourseSignal — an evidence-first student-life copilot in iMessage.",
  "",
  "Before I research or remember a course, reply START. TinyFish checks public web sources. If the optional OpenRouter answer composer is enabled, it receives your current sanitized question and short TinyFish evidence. A short follow-up may include the topic of the last answer, not your earlier messages. It does not receive your phone number or saved course name.",
  "",
  "I keep context separate for this chat and never submit coursework, purchase, book, or contact anyone.",
  "",
  "Please don’t send passwords, student IDs, private LMS links, or confidential documents.",
].join("\n");
const STARTED_REPLY = [
  "CourseSignal is ready.",
  "",
  "Ask about a course concept, campus service or event, textbook, scholarship, opportunity, or deadline.",
  "",
  "Optional: text COURSE STAT 210 to keep course context. After a result, reply SOURCES, PLAN, or WATCH.",
  "",
  "HELP shows every command. FORGET lets you erase this chat’s memory.",
].join("\n");
const HELP_REPLY = [
  "COURSESIGNAL COMMANDS",
  "Ask naturally — concepts, campus life, books, scholarships, opportunities, or deadlines",
  "COURSE <name> — optionally remember and select a course",
  "COURSE LIST — show remembered courses",
  "COURSE USE <name> — switch context",
  "COURSE REMOVE <name> — remove one course",
  "SOURCES — show the latest evidence receipt",
  "PLAN [goal] — build a source-linked study plan",
  "WATCH [source or topic] — opt into a change watch",
  "STOP — pause every proactive watch",
  "MEMORY — show what this chat remembers",
  "EXAMPLE — look again for a worked problem on the last topic",
  "FORGET — begin full deletion",
].join("\n");

type WorkItem = {
  envelope: InboundEnvelope;
  port: ConversationPort;
};

export class CourseSignalBridge {
  readonly #store: BridgeStore;
  readonly #research: ResearchService;
  readonly #logger: BridgeLogger;
  readonly #now: () => Date;
  readonly #coordinator: ConversationCoordinator<WorkItem>;

  constructor(options: {
    store: BridgeStore;
    research: ResearchService;
    logger?: BridgeLogger;
    debounceMs?: number;
    now?: () => Date;
  }) {
    this.#store = options.store;
    this.#research = options.research;
    this.#logger = options.logger ?? silentLogger;
    this.#now = options.now ?? (() => new Date());
    this.#coordinator = new ConversationCoordinator({
      debounceMs: options.debounceMs,
      consume: (conversationKey, items) => this.#consume(conversationKey, items),
    });
  }

  async handle(envelope: InboundEnvelope, port: ConversationPort): Promise<HandleDisposition> {
    const conversationRef = this.#logger.ref(envelope.conversationKey);
    const eventRef = this.#logger.ref(envelope.eventKey);
    let claimToken: string | undefined;
    try {
      claimToken = await this.#store.claimInbound(envelope.eventKey, envelope.receivedAt);
    } catch (error) {
      this.#logger.error("inbound.claim_failed", {
        conversationRef,
        eventRef,
        errorType: error instanceof Error ? error.name : typeof error,
      });
      await port.send("CourseSignal is temporarily unable to protect this message from duplicates, so I did not run it. Please try again shortly.");
      return "state-unavailable";
    }

    if (!claimToken) {
      this.#logger.info("inbound.duplicate", { conversationRef, eventRef });
      return "duplicate";
    }

    this.#logger.info("inbound.accepted", {
      conversationRef,
      eventRef,
      contentKind: envelope.content.type,
    });
    try {
      await this.#coordinator.enqueue(envelope.conversationKey, { envelope, port });
    } catch (error) {
      await this.#store.releaseInbound(envelope.eventKey, claimToken).catch(() => undefined);
      throw error;
    }
    await this.#store.completeInbound(envelope.eventKey, claimToken).catch((error) => {
      this.#logger.error("inbound.complete_failed", {
        conversationRef,
        eventRef,
        errorType: error instanceof Error ? error.name : typeof error,
      });
    });
    return "accepted";
  }

  async drain(): Promise<void> {
    await this.#coordinator.drain();
    await this.#store.close?.();
  }

  async #consume(conversationKey: string, items: WorkItem[]): Promise<void> {
    const memory = await this.#store.getConversation(conversationKey);
    const textItems = items.filter(
      (item): item is WorkItem & { envelope: InboundEnvelope & { content: { type: "text"; text: string } } } =>
        item.envelope.content.type === "text",
    );
    const canMerge =
      hasCurrentConsent(memory) &&
      textItems.length === items.length &&
      textItems.length > 1 &&
      textItems.every(({ envelope }) => !isControlCommand(parseCommand(envelope.content.text)));

    if (canMerge) {
      const last = textItems.at(-1)!;
      const merged = textItems.map(({ envelope }) => envelope.content.text.trim()).join("\n");
      await this.#processText(conversationKey, merged, last.port);
      return;
    }

    if (!hasCurrentConsent(memory) && items.length > 1 && !textItems.some(({ envelope }) => /^start$/i.test(envelope.content.text.trim()))) {
      await items.at(-1)!.port.send(CONSENT_PROMPT);
      return;
    }

    for (const item of items) {
      try {
        if (item.envelope.content.type !== "text") {
          await this.#processUnsupported(conversationKey, item.envelope.content.kind, item.port);
          continue;
        }
        await this.#processText(conversationKey, item.envelope.content.text, item.port);
      } catch (error) {
        this.#logger.error("message.processing_failed", {
          conversationRef: this.#logger.ref(conversationKey),
          errorType: error instanceof Error ? error.name : typeof error,
        });
        await item.port.send(SAFE_FAILURE_REPLY).catch(() => undefined);
      }
    }
  }

  async #processUnsupported(
    conversationKey: string,
    kind: string,
    port: ConversationPort,
  ): Promise<void> {
    const memory = await this.#store.getConversation(conversationKey);
    if (!hasCurrentConsent(memory)) {
      await port.send(CONSENT_PROMPT);
      return;
    }
    await port.send(
      `I received ${safeKind(kind)}, but this build only sends public web research from text and links. Add a short text question; I won’t upload or analyze the attachment.`,
    );
  }

  async #processText(
    conversationKey: string,
    rawText: string,
    port: ConversationPort,
  ): Promise<void> {
    const text = rawText.trim();
    if (!text) {
      await port.send("Send a course question, public link, or HELP for commands.");
      return;
    }

    const command = parseCommand(text);
    if (command.kind === "echo") {
      await port.send(`echo: ${command.text}`);
      return;
    }
    if (command.kind === "diagnostic") {
      await port.send(
        command.action === "ping"
          ? "pong"
          : "CourseSignal’s message bridge is reachable. Send ECHO <words> for a local round-trip or START to begin.",
      );
      return;
    }
    let memory = await this.#store.getConversation(conversationKey);
    if (!hasCurrentConsent(memory)) {
      if (command.kind !== "start") {
        await port.send(CONSENT_PROMPT);
        return;
      }
      memory = memory ?? emptyMemory(this.#now());
      memory.consentedAt = this.#now().toISOString();
      memory.consentVersion = CONSENT_VERSION;
      memory.updatedAt = this.#now().toISOString();
      await this.#store.putConversation(conversationKey, memory);
      await port.send(STARTED_REPLY);
      return;
    }

    switch (command.kind) {
      case "start":
        await port.send(STARTED_REPLY);
        return;
      case "help":
        await port.send(HELP_REPLY);
        return;
      case "sources":
        await port.send(formatSources(memory));
        return;
      case "memory":
        await port.send(formatMemory(memory));
        return;
      case "course":
        await this.#handleCourse(conversationKey, memory, command, port);
        return;
      case "watch":
        await this.#handleWatch(conversationKey, memory, command.target, port);
        return;
      case "stop":
        memory.watches = memory.watches.map((watch) => ({ ...watch, active: false }));
        memory.updatedAt = this.#now().toISOString();
        await this.#store.putConversation(conversationKey, memory);
        await port.send("All proactive watches are paused. You can still ask questions here; send WATCH when you want to opt in again.");
        return;
      case "forget":
        await this.#handleForget(conversationKey, memory, command.action, port);
        return;
      case "plan": {
        const prompt = command.prompt
          || memory.lastResearch?.topic
          || memory.lastResearch?.query
          || "review the active course topic";
        if (!command.prompt && !memory.lastResearch && !memory.activeCourse) {
          await port.send("Tell me the goal after PLAN, for example: PLAN prepare for Thursday’s probability quiz.");
          return;
        }
        await this.#runResearch(conversationKey, memory, prompt, "plan", port);
        return;
      }
      case "research":
        await this.#runResearch(conversationKey, memory, command.prompt, "answer", port);
        return;
    }
  }

  async #runResearch(
    conversationKey: string,
    memory: ConversationMemory,
    prompt: string,
    mode: ResearchMode,
    port: ConversationPort,
  ): Promise<void> {
    const resolved = mode === "answer"
      ? resolveStudentTurn(prompt, memory.lastResearch?.topic)
      : undefined;
    const query = resolved?.query ?? prompt;
    await port.send(
      mode === "plan"
        ? `Checking public sources${memory.activeCourse ? ` for ${memory.activeCourse}` : ""}, then I’ll build a study plan.`
        : "Checking public sources for that now.",
    );
    await bestEffort(port.startTyping);
    let result: ResearchResult;
    try {
      result = await this.#research.research({
        query,
        mode,
        course: memory.activeCourse,
      });
    } catch (error) {
      this.#logger.error("research.failed", {
        conversationRef: this.#logger.ref(conversationKey),
        errorType: error instanceof Error ? error.name : typeof error,
      });
      await port.send(SAFE_FAILURE_REPLY);
      return;
    } finally {
      await bestEffort(port.stopTyping);
    }

    memory.lastResearch = {
      query: query.slice(0, 1_200),
      topic: (resolved?.topic ?? memory.lastResearch?.topic ?? deriveTopic(prompt)).slice(0, 240),
      mode,
      course: memory.activeCourse,
      checkedAt: result.checkedAt,
      endpoints: result.endpoints,
      sources: result.sources.slice(0, 5),
    };
    memory.forgetRequestedAt = undefined;
    memory.updatedAt = this.#now().toISOString();
    await this.#store.putConversation(conversationKey, memory);
    await port.send(result.body);
    this.#logger.info("research.completed", {
      conversationRef: this.#logger.ref(conversationKey),
      sourceCount: result.sources.length,
      endpointCount: result.endpoints.length,
      mode,
    });
  }

  async #handleCourse(
    conversationKey: string,
    memory: ConversationMemory,
    command: Extract<ParsedCommand, { kind: "course" }>,
    port: ConversationPort,
  ): Promise<void> {
    if (command.action === "list") {
      await port.send(formatCourses(memory));
      return;
    }
    if (command.action === "clear") {
      memory.courses = [];
      memory.activeCourse = undefined;
      memory.updatedAt = this.#now().toISOString();
      await this.#store.putConversation(conversationKey, memory);
      await port.send("Course names are cleared. Your consent and evidence receipt are unchanged; send FORGET to erase everything.");
      return;
    }

    const name = normalizeCourseName(command.name);
    if (!name) {
      await port.send("Use a short course name, for example: COURSE STAT 210.");
      return;
    }
    const existing = memory.courses.find((course) => course.toLowerCase() === name.toLowerCase());

    if (command.action === "remove") {
      if (!existing) {
        await port.send(`I don’t have “${name}” in this chat’s course memory.`);
        return;
      }
      memory.courses = memory.courses.filter((course) => course !== existing);
      if (memory.activeCourse === existing) memory.activeCourse = memory.courses[0];
      memory.updatedAt = this.#now().toISOString();
      await this.#store.putConversation(conversationKey, memory);
      await port.send(`Removed ${existing}. ${memory.activeCourse ? `Active course: ${memory.activeCourse}.` : "No course is active."}`);
      return;
    }

    if (command.action === "use" && !existing) {
      await port.send(`I don’t remember “${name}” yet. Send COURSE ${name} to add it.`);
      return;
    }

    const selected = existing ?? name;
    if (!existing) {
      if (memory.courses.length >= 8) {
        await port.send("This chat already remembers 8 courses. Remove one with COURSE REMOVE <name> first.");
        return;
      }
      memory.courses.push(selected);
    }
    memory.activeCourse = selected;
    memory.updatedAt = this.#now().toISOString();
    await this.#store.putConversation(conversationKey, memory);
    await port.send(`${selected} is now the active course. Send a question or public course link when ready.`);
  }

  async #handleWatch(
    conversationKey: string,
    memory: ConversationMemory,
    requestedTarget: string,
    port: ConversationPort,
  ): Promise<void> {
    const target = requestedTarget.trim() || memory.lastResearch?.sources[0]?.url || memory.lastResearch?.query || "";
    if (!target) {
      await port.send("Send WATCH after a sourced result, or use WATCH <public URL or topic>.");
      return;
    }
    const normalized = target.slice(0, 500);
    const existing = memory.watches.find((watch) => watch.target.toLowerCase() === normalized.toLowerCase());
    if (existing) {
      existing.active = true;
    } else {
      if (memory.watches.length >= 5) {
        await port.send("This chat already has 5 watches. Send STOP to pause them before replacing one.");
        return;
      }
      memory.watches.push({
        id: randomUUID(),
        target: normalized,
        course: memory.activeCourse,
        createdAt: this.#now().toISOString(),
        active: true,
      });
    }
    memory.updatedAt = this.#now().toISOString();
    await this.#store.putConversation(conversationKey, memory);
    await port.send("Watch preference saved. CourseSignal may text only for a meaningful verified change—never routine ‘no change’ updates. Send STOP anytime.");
  }

  async #handleForget(
    conversationKey: string,
    memory: ConversationMemory,
    action: "request" | "confirm" | "cancel",
    port: ConversationPort,
  ): Promise<void> {
    if (action === "cancel") {
      memory.forgetRequestedAt = undefined;
      memory.updatedAt = this.#now().toISOString();
      await this.#store.putConversation(conversationKey, memory);
      await port.send("Deletion cancelled. Nothing was removed.");
      return;
    }
    if (action === "request") {
      memory.forgetRequestedAt = this.#now().toISOString();
      memory.updatedAt = this.#now().toISOString();
      await this.#store.putConversation(conversationKey, memory);
      await port.send("This will erase course names, the latest evidence receipt, watches, and consent for this chat. Reply FORGET CONFIRM within 10 minutes, or FORGET CANCEL.");
      return;
    }

    const requestedAt = memory.forgetRequestedAt ? Date.parse(memory.forgetRequestedAt) : 0;
    if (!requestedAt || this.#now().getTime() - requestedAt > 10 * 60 * 1_000) {
      memory.forgetRequestedAt = undefined;
      await this.#store.putConversation(conversationKey, memory);
      await port.send("The deletion confirmation expired. Send FORGET again to start a new confirmation.");
      return;
    }
    await this.#store.deleteConversation(conversationKey);
    await port.send("Done. This chat’s CourseSignal memory and consent were deleted. Reply START if you want to use it again.");
  }
}

function emptyMemory(now: Date): ConversationMemory {
  return { courses: [], watches: [], updatedAt: now.toISOString() };
}

function hasCurrentConsent(
  memory: ConversationMemory | undefined,
): memory is ConversationMemory & { consentedAt: string; consentVersion: 3 } {
  return Boolean(memory?.consentedAt) && memory?.consentVersion === CONSENT_VERSION;
}

const FOLLOW_UP_CUE =
  /\b(?:examples?|simpler|easier|why|another|again|elaborate|expand|clarify|explainable|walk me through|show me|break (?:it |this )?down)\b/i;
const NEW_QUESTION =
  /^(?:what(?:'s| is| are)|who(?:'s| is| are)?|when|where|which|explain|define|describe|find|search|look up|how (?:much|many|do|does|can|should|is|are)|am i|is there|are there|tell me about)\b/i;
const FOLLOW_UP_STOP = new Set([
  "give", "please", "could", "would", "explain", "explainable", "example", "examples",
  "simpler", "simple", "easier", "another", "show", "walk", "through", "that", "this",
  "with", "from", "about", "what", "when", "where", "which", "have", "make", "want",
  "need", "just", "more", "less", "also", "then", "than", "into", "your", "mine",
  "worked", "step", "steps", "plain", "again", "why", "how", "does", "mean", "means",
  "like", "using", "tell", "text", "look", "help", "can", "you", "for", "and", "the",
  "get", "got", "one", "some", "any", "detail", "details", "info", "information",
  "happen", "happens", "sense", "thanks", "thank",
]);

export type ResolvedTurn = {
  query: string;
  topic: string;
  followUp: boolean;
};

/** Standing subject with question framing removed, for follow-ups and study plans. */
export function deriveTopic(prompt: string): string {
  const stripped = prompt
    .replace(/^(?:please\s+)?(?:can you |could you |would you )?(?:please\s+)?(?:explain|define|describe|tell me about|what(?:'s| is| are)|how (?:do|does|is|are)|find|look up)\s+/i, "")
    .replace(/[?!.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (stripped || prompt.trim()).slice(0, 240);
}

function novelTerms(text: string, topic: string): string[] {
  const topicBlob = topic.toLowerCase();
  return text
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((word) => word.length >= 4 && !FOLLOW_UP_STOP.has(word) && !topicBlob.includes(word));
}

function isFollowUp(text: string, topic: string): boolean {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 18) return false;
  if (novelTerms(text, topic).length > 0) return false;
  if (NEW_QUESTION.test(text)) return false;
  return FOLLOW_UP_CUE.test(text) || words.length <= 5;
}

/**
 * Short anaphoric messages continue the last topic. A standalone question replaces it.
 * The resolved query is what TinyFish and the composer see; it is not a chat transcript.
 */
export function resolveStudentTurn(prompt: string, previousTopic?: string): ResolvedTurn {
  const text = prompt.replace(/\s+/g, " ").trim();
  const topic = deriveTopic(text);
  const standing = previousTopic?.replace(/\s+/g, " ").trim().slice(0, 240);
  if (!standing || !isFollowUp(text, standing)) {
    return { query: text, topic, followUp: false };
  }
  return {
    query: `${standing} — ${text}`.slice(0, 1_200),
    topic: standing,
    followUp: true,
  };
}

function normalizeCourseName(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function formatCourses(memory: ConversationMemory): string {
  if (memory.courses.length === 0) return "No courses remembered. Add one with COURSE <name>.";
  return [
    "REMEMBERED COURSES",
    ...memory.courses.map((course) => `${course === memory.activeCourse ? "●" : "○"} ${course}`),
    "",
    "Use COURSE USE <name> to switch.",
  ].join("\n");
}

function formatSources(memory: ConversationMemory): string {
  const research = memory.lastResearch;
  if (!research || research.sources.length === 0) {
    return "There isn’t an evidence receipt yet. Send a question or public course link first.";
  }
  return [
    "EVIDENCE RECEIPT",
    `Checked ${formatCheckedAt(research.checkedAt)}`,
    `TinyFish: ${research.endpoints.join(" → ") || "none"}`,
    "",
    ...research.sources.slice(0, 4).flatMap((source, index) => [
      `${index + 1}. ${displaySourceTitle(source.title, source.url)}`,
      cleanReceiptText(source.excerpt, 420),
      source.url,
      "",
    ]),
  ].join("\n");
}

function formatMemory(memory: ConversationMemory): string {
  const activeWatches = memory.watches.filter(({ active }) => active).length;
  return [
    "THIS CHAT REMEMBERS",
    `Active course: ${memory.activeCourse ?? "none"}`,
    `Courses: ${memory.courses.length}`,
    `Latest receipt: ${memory.lastResearch ? memory.lastResearch.checkedAt : "none"}`,
    `Active watches: ${activeWatches}`,
    "",
    "CourseSignal does not show or log your phone number here. Send FORGET to erase this chat’s memory.",
  ].join("\n");
}

function safeKind(kind: string): string {
  const cleaned = kind.replace(/[^a-z0-9_-]/gi, "").slice(0, 24).toLowerCase();
  return cleaned ? `a ${cleaned}` : "non-text content";
}

async function bestEffort(operation: (() => Promise<void>) | undefined): Promise<void> {
  if (!operation) return;
  await operation().catch(() => undefined);
}

/** Compatibility helper for the original proof and narrow integrations. */
export async function replyForText(text: string): Promise<string> {
  const local = parseCommand(text);
  if (local.kind === "echo") return `echo: ${local.text}`;
  if (local.kind === "diagnostic") {
    return local.action === "ping"
      ? "pong"
      : "CourseSignal’s message bridge is reachable. Send ECHO <words> for a local round-trip or START to begin.";
  }
  const store = new InMemoryBridgeStore();
  const output: string[] = [];
  const bridge = new CourseSignalBridge({
    store,
    research: createTinyFishResearchService(),
    debounceMs: 0,
  });
  const port: ConversationPort = { send: async (body) => void output.push(body) };
  const now = new Date().toISOString();
  await bridge.handle(
    { eventKey: "compat-start", conversationKey: "compat", receivedAt: now, content: { type: "text", text: "START" } },
    port,
  );
  await bridge.handle(
    { eventKey: "compat-query", conversationKey: "compat", receivedAt: now, content: { type: "text", text } },
    port,
  );
  return output.at(-1) ?? SAFE_FAILURE_REPLY;
}
