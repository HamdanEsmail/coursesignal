import { randomUUID } from "node:crypto";
import { LodgeAgent, extractStudentUrls, type LodgeLocalToolHandler, type LodgeTinyFishPort } from "./agent.js";
import {
  applyCheckInAnswer,
  beginCheckIn,
  checkInPrompt,
  firstPublicUrl,
  isCheckInOpen,
  isSkipText,
  looksLikeCheckInInterrupt,
  saveLink,
} from "./checkin.js";
import { isControlCommand, parseCommand, type ParsedCommand } from "./commands.js";
import { ConversationCoordinator } from "./coordinator.js";
import { silentLogger } from "./logger.js";
import { markLastOpportunityApplied, markReminderDone, showNotes } from "./notebook.js";
import { createTinyFishResearchService } from "./research.js";
import { buildSlipUrl } from "./slips.js";
import { InMemoryBridgeStore } from "./store.js";
import { formatHowDidYouGetThat } from "./trace.js";
import {
  createLodgeTools,
  FIRSTROLE_LINE,
  FIRSTROLE_URL,
  formatLodgeToolContent,
  parseReminderWhen,
  type LodgeRolesFinder,
} from "./tools.js";
import {
  LODGE_CONSENT_VERSION,
  LODGE_DEFAULT_QUIET_END,
  LODGE_DEFAULT_QUIET_START,
  LODGE_DEFAULT_TIMEZONE,
  type BridgeLogger,
  type BridgeStore,
  type ConversationMemory,
  type ConversationPort,
  type ConversationReaction,
  type HandleDisposition,
  type InboundContent,
  type InboundEnvelope,
  type ResearchMode,
  type ResearchResult,
  type ResearchService,
} from "./types.js";

const SAFE_FAILURE_REPLY =
  "I could not verify that from live sources. I have not guessed or started another paid run. Try again in a bit.";
const CONSENT_VERSION = LODGE_CONSENT_VERSION;
const CONSENT_PROMPT = [
  "Welcome to Lodge — a college-lodge friend in iMessage.",
  "",
  "Before I look anything up or remember a page, reply START. TinyFish checks public web pages (Search, Fetch, and sometimes a read-only Agent). If Gemma is on, it chooses those tools. It does not receive your phone number.",
  "",
  "I never apply, sign in, email anyone, or submit a form.",
  "",
  "Please don’t send passwords, student IDs, private LMS links, or confidential documents.",
].join("\n");
const STARTED_REPLY = [
  "Lodge is ready. Optional check-in — skip anytime.",
  "",
  checkInPrompt("school"),
].join("\n");
const HELP_REPLY = [
  "LODGE",
  "Ask in ordinary words — deadlines, events, a public page, a poster photo, internships in a city.",
  "START — begin. skip — skip a check-in question.",
  "what’s due / what’s on — read a saved course or events page.",
  "remind me in 5 minutes — Lodge texts first after you confirm. 👍 done.",
  "note that … / show notes — notebook (cap 30). ❤️ pins the last list.",
  "how did you get that? — the ledger.",
  "FORGET — erase this chat. STOP — pause watches.",
  `Roles: 1–3 public listings, never an application. ${FIRSTROLE_LINE}`,
  "If Lodge could not reopen this chat after a restart, it will say so — scheduled texts wait until you are back.",
].join("\n");
const COURSE_PAGE_HINT =
  "Lodge remembers public course pages, not course codes. Paste a syllabus URL, or skip check-in.";
const PHOTO_UNWIRED =
  "I saw a photo. I can save a note or add it to the calendar once I can read images — or tell me the time and place now.";
const REACTIONS = new Set<string>(["love", "like", "dislike", "question"]);

type WorkItem = {
  envelope: InboundEnvelope;
  port: ConversationPort;
};

export type LodgeVisionHandler = {
  describe(input: { mimeType: string; body: unknown }): Promise<string | undefined>;
};

export type LodgeBridgeOptions = {
  store: BridgeStore;
  research: ResearchService;
  logger?: BridgeLogger;
  debounceMs?: number;
  now?: () => Date;
  tinyfish?: LodgeTinyFishPort;
  createAgent?: (localTools: LodgeLocalToolHandler) => LodgeAgent;
  vision?: LodgeVisionHandler;
  roles?: LodgeRolesFinder;
};

export class CourseSignalBridge {
  readonly #store: BridgeStore;
  readonly #research: ResearchService;
  readonly #logger: BridgeLogger;
  readonly #now: () => Date;
  readonly #coordinator: ConversationCoordinator<WorkItem>;
  readonly #tinyfish?: LodgeTinyFishPort;
  readonly #createAgent?: (localTools: LodgeLocalToolHandler) => LodgeAgent;
  readonly #vision?: LodgeVisionHandler;
  readonly #roles?: LodgeRolesFinder;

  constructor(options: LodgeBridgeOptions) {
    this.#store = options.store;
    this.#research = options.research;
    this.#logger = options.logger ?? silentLogger;
    this.#now = options.now ?? (() => new Date());
    this.#tinyfish = options.tinyfish;
    this.#createAgent = options.createAgent;
    this.#vision = options.vision;
    this.#roles = options.roles;
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
      await port.send("Lodge is temporarily unable to protect this message from duplicates, so I did not run it. Please try again shortly.");
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
      !isCheckInOpen(memory) &&
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
          await this.#processNonText(conversationKey, item.envelope.content, item.port);
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

  async #processNonText(
    conversationKey: string,
    content: InboundContent,
    port: ConversationPort,
  ): Promise<void> {
    const memory = await this.#store.getConversation(conversationKey);
    if (!hasCurrentConsent(memory)) {
      await port.send(CONSENT_PROMPT);
      return;
    }
    if (content.type === "unsupported" && REACTIONS.has(content.kind)) {
      await this.#processReaction(conversationKey, memory, content.kind as ConversationReaction, port);
      return;
    }
    if (content.type === "unsupported" && content.kind === "image") {
      await this.#processPhoto(conversationKey, memory, content, port);
      return;
    }
    if (content.type === "unsupported" && content.kind === "poll_vote") {
      const option = "option" in content && typeof content.option === "string" ? content.option : "";
      if (option) {
        await this.#processText(conversationKey, option, port);
        return;
      }
    }
    await port.send(
      `I received ${safeKind(content.type === "unsupported" ? content.kind : "attachment")}, but Lodge works from text, links, photos, and a small set of tapbacks.`,
    );
  }

  async #processPhoto(
    conversationKey: string,
    memory: ConversationMemory,
    content: InboundContent,
    port: ConversationPort,
  ): Promise<void> {
    const image = content as InboundContent & { mimeType?: string; read?: () => Promise<unknown> };
    if (!this.#vision || !image.read) {
      await sendLodge(port, [PHOTO_UNWIRED]);
      return;
    }
    let body: unknown;
    try {
      body = await image.read();
    } catch {
      await sendLodge(port, [PHOTO_UNWIRED]);
      return;
    }
    const described = await this.#vision.describe({ mimeType: image.mimeType ?? "image/*", body });
    if (!described) {
      await sendLodge(port, [PHOTO_UNWIRED]);
      return;
    }
    memory.pendingRememberPage = {
      url: "https://coursesignal-bzb.pages.dev/slip?title=Photo",
      title: described.slice(0, 160),
      excerpt: described.slice(0, 400),
      offeredAt: this.#now().toISOString(),
      kind: "other",
    };
    memory.updatedAt = this.#now().toISOString();
    await this.#store.putConversation(conversationKey, memory);
    await sendLodge(port, [
      described.slice(0, 400),
      "I have not stored the image. Reply note that … or send the time and place to save a calendar slip.",
    ]);
  }

  async #processReaction(
    conversationKey: string,
    memory: ConversationMemory,
    reaction: ConversationReaction,
    port: ConversationPort,
  ): Promise<void> {
    const tools = this.#tools(conversationKey, port);
    if (reaction === "love") {
      await this.#emitTool(port, tools, "notebook", { action: "pin", text: null });
      return;
    }
    if (reaction === "like") {
      const done = markReminderDone(memory, this.#now());
      if (done.ok) {
        await this.#store.putConversation(conversationKey, done.memory);
        await sendLodge(port, [`Done: ${done.reminder.text}.`]);
        return;
      }
      await sendLodge(port, ["Nothing waiting on a 👍."]);
      return;
    }
    if (reaction === "dislike") {
      await this.#pauseWatches(conversationKey, memory, port);
      return;
    }
    await sendLodge(port, [memory.lastTrace ? formatHowDidYouGetThat(memory.lastTrace) : "I have not checked a live page this turn."]);
  }

  async #processText(
    conversationKey: string,
    rawText: string,
    port: ConversationPort,
  ): Promise<void> {
    const text = rawText.trim();
    if (!text) {
      await port.send("Send a question, a public link, or HELP.");
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
          : "Lodge’s message bridge is reachable. Send ECHO <words> for a local round-trip or START to begin.",
      );
      return;
    }
    let memory = await this.#store.getConversation(conversationKey);
    if (!hasCurrentConsent(memory)) {
      if (command.kind !== "start") {
        await port.send(CONSENT_PROMPT);
        return;
      }
      memory = beginCheckIn(emptyMemory(this.#now()), this.#now());
      memory.consentedAt = this.#now().toISOString();
      memory.consentVersion = CONSENT_VERSION;
      await this.#store.putConversation(conversationKey, memory);
      await port.send(STARTED_REPLY);
      return;
    }

    if (command.kind === "start") {
      memory = beginCheckIn(memory, this.#now());
      memory.consentedAt = this.#now().toISOString();
      memory.consentVersion = CONSENT_VERSION;
      await this.#store.putConversation(conversationKey, memory);
      await port.send(STARTED_REPLY);
      return;
    }

    if (isCheckInOpen(memory) && shouldApplyCheckIn(command.kind, text, memory.checkInStep ?? "done")) {
      const result = applyCheckInAnswer(memory, text, this.#now());
      if (result.kind === "consumed") {
        await this.#store.putConversation(conversationKey, result.memory);
        if (command.kind === "find_roles" || command.kind === "whats_due" || command.kind === "whats_on") {
          memory = result.memory;
        } else {
          await sendLodge(port, [result.reply]);
          return;
        }
      } else {
        memory = result.memory;
        await this.#store.putConversation(conversationKey, memory);
        if (isSkipText(text)) {
          await sendLodge(port, [checkInPrompt(memory.checkInStep ?? "done")]);
          return;
        }
      }
    }

    switch (command.kind) {
      case "help":
        await port.send(HELP_REPLY);
        return;
      case "sources":
      case "show_trace":
        await sendLodge(port, [
          memory.lastTrace ? formatHowDidYouGetThat(memory.lastTrace) : "There isn’t a ledger yet. Ask something I can look up first.",
        ]);
        return;
      case "memory":
      case "show_notes":
        await sendLodge(port, [formatMemory(memory)]);
        return;
      case "course":
        await sendLodge(port, [COURSE_PAGE_HINT]);
        return;
      case "watch":
        await this.#handleWatch(conversationKey, memory, command.target, port);
        return;
      case "stop":
        await this.#pauseWatches(conversationKey, memory, port);
        return;
      case "forget":
        await this.#handleForget(conversationKey, memory, command.action, port);
        return;
      case "forget_note": {
        const tools = this.#tools(conversationKey, port);
        await this.#emitTool(port, tools, "notebook", { action: "forget", text: command.text || null });
        return;
      }
      case "note": {
        const tools = this.#tools(conversationKey, port);
        await this.#emitTool(port, tools, "notebook", { action: "note", text: command.text || null });
        return;
      }
      case "remind": {
        const tools = this.#tools(conversationKey, port);
        await this.#emitTool(port, tools, "remind_me", { text: command.text, when: command.when });
        return;
      }
      case "snooze":
        await this.#handleSnooze(conversationKey, memory, command.duration, port);
        return;
      case "whats_due":
        await this.#emitTool(port, this.#tools(conversationKey, port), "whats_due", {});
        return;
      case "whats_on":
        await this.#emitTool(port, this.#tools(conversationKey, port), "whats_on", {});
        return;
      case "applied": {
        const applied = markLastOpportunityApplied(memory, this.#now());
        if (!applied.ok) {
          await sendLodge(port, ["I don’t have a pinned opening to mark. Heart a listing first."]);
          return;
        }
        await this.#store.putConversation(conversationKey, applied.memory);
        await sendLodge(port, [`Marked applied: ${applied.note.text}. ${FIRSTROLE_LINE}`]);
        return;
      }
      case "save":
        await this.#handleSave(conversationKey, memory, port);
        return;
      case "confirm":
        await this.#handleConfirm(conversationKey, memory, port);
        return;
      case "find_roles":
        await this.#emitTool(port, this.#tools(conversationKey, port), "find_roles", {
          query: command.query,
          city: command.city || memory.rolesCity || "",
        });
        return;
      case "plan": {
        if (!command.prompt) {
          await this.#emitTool(port, this.#tools(conversationKey, port), "plan_week", {});
          return;
        }
        await this.#runTurn(conversationKey, memory, command.prompt, "plan", port);
        return;
      }
      case "skip":
        await sendLodge(port, ["Nothing to skip."]);
        return;
      case "research":
        await this.#runTurn(conversationKey, memory, command.prompt, "answer", port);
        return;
    }
  }

  async #runTurn(
    conversationKey: string,
    memory: ConversationMemory,
    prompt: string,
    mode: ResearchMode,
    port: ConversationPort,
  ): Promise<void> {
    const urlOnly = mostlyUrl(prompt);
    if (urlOnly) {
      await this.#offerPastedUrl(conversationKey, memory, prompt, port);
      return;
    }

    const tools = this.#tools(conversationKey, port);
    const agent = this.#createAgent?.(tools);
    if (agent) {
      await this.#runAgent(conversationKey, memory, prompt, port, agent);
      return;
    }
    await this.#runResearch(conversationKey, memory, prompt, mode, port);
  }

  async #runAgent(
    conversationKey: string,
    memory: ConversationMemory,
    prompt: string,
    port: ConversationPort,
    agent: LodgeAgent,
  ): Promise<void> {
    await bestEffort(port.startTyping);
    await progressSlip(port, "Looking it up…");
    try {
      const result = await agent.run({
        text: prompt,
        savedLinks: (memory.savedLinks ?? []).map((link) => ({ url: link.url, title: link.title })),
        timezone: memory.timezone ?? LODGE_DEFAULT_TIMEZONE,
        previousTrace: memory.lastTrace,
      });
      const latest = await this.#store.getConversation(conversationKey) ?? memory;
      latest.lastTrace = result.trace;
      latest.lastResearch = {
        query: prompt.slice(0, 1_200),
        topic: deriveTopic(prompt),
        mode: "answer",
        checkedAt: result.trace.at,
        endpoints: result.trace.steps
          .map((step) => step.tool)
          .filter((tool): tool is "search" | "fetch" | "agent" => tool === "search" || tool === "fetch" || tool === "agent"),
        sources: result.grounding.citations.slice(0, 5).map((citation) => ({
          title: citation.title ?? "Source",
          url: citation.url ?? "",
          excerpt: citation.text,
          endpoint: citation.tool === "other" ? "fetch" : citation.tool,
        })),
      };
      latest.updatedAt = this.#now().toISOString();
      await this.#store.putConversation(conversationKey, latest);
      const title = progressTitle(result.trace.steps.at(-1)?.tool) ?? "Lodge slip";
      await progressSlip(port, title);
      await sendLodge(port, lodgeBubbles(result.reply));
    } catch (error) {
      this.#logger.error("lodge.agent_failed", {
        conversationRef: this.#logger.ref(conversationKey),
        errorType: error instanceof Error ? error.name : typeof error,
      });
      await port.send(SAFE_FAILURE_REPLY);
    } finally {
      await bestEffort(port.stopTyping);
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
    await progressSlip(port, "Looking it up…");
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
    const pasted = firstPublicUrl(prompt);
    const bubbles = lodgeBubbles(result.body);
    if (pasted && bubbles.length < 3) {
      memory.pendingRememberPage = {
        url: pasted,
        kind: "other",
        offeredAt: this.#now().toISOString(),
      };
      await this.#store.putConversation(conversationKey, memory);
      bubbles.push("Want me to save that page? Reply save.");
    }
    await sendLodge(port, bubbles);
  }

  async #offerPastedUrl(
    conversationKey: string,
    memory: ConversationMemory,
    prompt: string,
    port: ConversationPort,
  ): Promise<void> {
    const url = firstPublicUrl(prompt);
    if (!url) {
      await this.#runResearch(conversationKey, memory, prompt, "answer", port);
      return;
    }
    memory.pendingRememberPage = {
      url,
      kind: guessLinkKind(url),
      offeredAt: this.#now().toISOString(),
    };
    let detail = url;
    if (this.#tinyfish) {
      await progressSlip(port, "Reading your page…");
      try {
        const page = await this.#tinyfish.fetch(url);
        memory.pendingRememberPage.title = page.title;
        memory.pendingRememberPage.excerpt = page.text.slice(0, 400);
        detail = `${page.title || url}\n${page.text.replace(/\s+/g, " ").trim().slice(0, 240)}`;
      } catch {
        detail = url;
      }
    }
    memory.updatedAt = this.#now().toISOString();
    await this.#store.putConversation(conversationKey, memory);
    await sendLodge(port, [detail, "Want me to save this page? Reply save."]);
  }

  async #emitTool(
    port: ConversationPort,
    tools: LodgeLocalToolHandler,
    name: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    await bestEffort(port.startTyping);
    try {
      const result = await tools.execute(name, args);
      const formatted = formatLodgeToolContent(name, result.content);
      if (formatted.slip) await progressSlip(port, formatted.slip.title, formatted.slip);
      await sendLodge(port, formatted.bubbles, formatted.slip);
    } finally {
      await bestEffort(port.stopTyping);
    }
  }

  #tools(conversationKey: string, port?: ConversationPort): LodgeLocalToolHandler {
    return createLodgeTools({
      store: this.#store,
      conversationKey,
      now: this.#now,
      tinyfish: this.#tinyfish,
      roles: this.#roles,
      onProgress: port
        ? async (label) => {
          await progressSlip(port, label);
        }
        : undefined,
    });
  }

  async #handleSave(
    conversationKey: string,
    memory: ConversationMemory,
    port: ConversationPort,
  ): Promise<void> {
    const pending = memory.pendingRememberPage;
    if (!pending) {
      await sendLodge(port, ["Nothing waiting to save. Paste a public URL first."]);
      return;
    }
    const next = saveLink(memory, {
      kind: pending.kind ?? "other",
      url: pending.url,
      title: pending.title,
    }, this.#now());
    next.pendingRememberPage = undefined;
    await this.#store.putConversation(conversationKey, next);
    await sendLodge(port, [`Saved ${pending.title ?? pending.url}.`]);
  }

  async #handleConfirm(
    conversationKey: string,
    memory: ConversationMemory,
    port: ConversationPort,
  ): Promise<void> {
    const reminders = [...(memory.pendingReminders ?? [])];
    const index = reminders.findLastIndex((item) => item.status === "pending_confirm");
    if (index < 0) {
      await sendLodge(port, ["Nothing waiting on a yes."]);
      return;
    }
    const reminder = {
      ...reminders[index]!,
      status: "scheduled" as const,
      confirmedAt: this.#now().toISOString(),
    };
    reminders[index] = reminder;
    memory.pendingReminders = reminders;
    memory.updatedAt = this.#now().toISOString();
    await this.#store.putConversation(conversationKey, memory);
    await sendLodge(port, [`Confirmed. I’ll text first at ${reminder.localFireLabel ?? reminder.fireAt}.`]);
  }

  async #handleSnooze(
    conversationKey: string,
    memory: ConversationMemory,
    duration: string,
    port: ConversationPort,
  ): Promise<void> {
    const reminders = [...(memory.pendingReminders ?? [])];
    const index = reminders.findLastIndex((item) =>
      item.status === "scheduled" || item.status === "fired" || item.status === "snoozed"
    );
    if (index < 0) {
      await sendLodge(port, ["Nothing to snooze."]);
      return;
    }
    const fire = parseReminderWhen(duration, this.#now(), memory.timezone ?? LODGE_DEFAULT_TIMEZONE);
    if (!fire) {
      await sendLodge(port, ["Try snooze 1h."]);
      return;
    }
    reminders[index] = {
      ...reminders[index]!,
      status: "snoozed",
      snoozeUntil: fire.toISOString(),
      fireAt: fire.toISOString(),
    };
    memory.pendingReminders = reminders;
    memory.updatedAt = this.#now().toISOString();
    await this.#store.putConversation(conversationKey, memory);
    await sendLodge(port, [`Snoozed until ${fire.toISOString()}.`]);
  }

  async #handleWatch(
    conversationKey: string,
    memory: ConversationMemory,
    requestedTarget: string,
    port: ConversationPort,
  ): Promise<void> {
    const target = requestedTarget.trim() || memory.lastResearch?.sources[0]?.url || memory.pendingRememberPage?.url || "";
    if (!target) {
      await port.send("Send WATCH after a sourced result, or use WATCH <public URL>.");
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
    const url = firstPublicUrl(normalized);
    if (url) {
      const saved = saveLink(memory, { kind: "other", url }, this.#now());
      const link = saved.savedLinks?.find((item) => item.url === url);
      if (link) link.watchEnabled = true;
      Object.assign(memory, saved);
    }
    memory.updatedAt = this.#now().toISOString();
    await this.#store.putConversation(conversationKey, memory);
    await port.send("Watch saved. Lodge may text only for a meaningful verified change — never a routine ‘no change’. Send STOP anytime.");
  }

  async #pauseWatches(
    conversationKey: string,
    memory: ConversationMemory,
    port: ConversationPort,
  ): Promise<void> {
    memory.watches = memory.watches.map((watch) => ({ ...watch, active: false }));
    memory.rolesOptIn = false;
    memory.updatedAt = this.#now().toISOString();
    await this.#store.putConversation(conversationKey, memory);
    await port.send("All proactive watches are paused. You can still ask here; send WATCH when you want to opt in again.");
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
      await port.send("This will erase the notebook, reminders, saved pages, watches, and consent for this chat. Reply FORGET CONFIRM within 10 minutes, or FORGET CANCEL.");
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
    await port.send("Done. This chat’s Lodge memory and consent were deleted. Reply START if you want to use it again.");
  }
}

function emptyMemory(now: Date): ConversationMemory {
  return {
    courses: [],
    watches: [],
    updatedAt: now.toISOString(),
    timezone: LODGE_DEFAULT_TIMEZONE,
    quietHours: {
      start: LODGE_DEFAULT_QUIET_START,
      end: LODGE_DEFAULT_QUIET_END,
      enabled: true,
    },
    notebook: [],
    savedLinks: [],
    pendingReminders: [],
  };
}

function hasCurrentConsent(
  memory: ConversationMemory | undefined,
): memory is ConversationMemory & { consentedAt: string; consentVersion: typeof LODGE_CONSENT_VERSION } {
  return Boolean(memory?.consentedAt) && memory?.consentVersion === CONSENT_VERSION;
}

function shouldApplyCheckIn(
  kind: ParsedCommand["kind"],
  text: string,
  step: NonNullable<ConversationMemory["checkInStep"]>,
): boolean {
  return kind === "skip"
    || kind === "research"
    || kind === "find_roles"
    || kind === "save"
    || kind === "whats_due"
    || kind === "whats_on"
    || kind === "remind"
    || kind === "note"
    || kind === "plan"
    || looksLikeCheckInInterrupt(text, step);
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

function formatMemory(memory: ConversationMemory): string {
  const activeWatches = memory.watches.filter(({ active }) => active).length;
  const pending = (memory.pendingReminders ?? []).filter((item) =>
    item.status === "scheduled" || item.status === "pending_confirm" || item.status === "snoozed"
  ).length;
  return [
    showNotes(memory),
    "",
    `School: ${memory.school ?? "unset"} · ${memory.timezone ?? LODGE_DEFAULT_TIMEZONE}`,
    `Saved pages: ${(memory.savedLinks ?? []).length}`,
    `Reminders: ${pending}`,
    `Active watches: ${activeWatches}`,
    "",
    "Lodge does not show or log your phone number here. Send FORGET to erase this chat’s memory.",
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

async function progressSlip(
  port: ConversationPort,
  title: string,
  slip?: { title: string; url?: string; start?: string; end?: string; location?: string },
): Promise<void> {
  const card = slip ?? { title };
  try {
    const url = buildSlipUrl(card);
    const sent = await port.sendApp?.({ url, title: card.title });
    if (sent && port.edit && sent.messageId) {
      await port.edit(sent.messageId, card.title).catch(() => undefined);
    }
  } catch {
    // Never block the answer on the card.
  }
}

async function sendLodge(
  port: ConversationPort,
  bubbles: string[],
  slip?: { title: string; url?: string; start?: string; end?: string; location?: string },
): Promise<void> {
  if (slip) {
    await progressSlip(port, slip.title, slip);
    await port.sendRichLink?.({ url: buildSlipUrl(slip), title: slip.title }).catch(() => undefined);
  }
  for (const bubble of lodgeBubbles(bubbles.join("\n\n"))) {
    await port.send(lodgeSafeText(bubble));
  }
}

function lodgeBubbles(text: string): string[] {
  const cleaned = lodgeSafeText(text).trim();
  if (!cleaned) return [];
  const parts = cleaned.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1) return parts.slice(0, 3);
  if (cleaned.length <= 420) return [cleaned];
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= 1) return [cleaned.slice(0, 900)];
  const grouped: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > 280 && current && grouped.length < 2) {
      grouped.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }
  if (current) grouped.push(current);
  return grouped.slice(0, 3);
}

function lodgeSafeText(text: string): string {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted]")
    .replace(/\bCourseSignal\b/gi, "Lodge")
    .replace(/\bSTAT 210\b/gi, "your course");
}

function mostlyUrl(text: string): boolean {
  const urls = extractStudentUrls(text);
  if (urls.length === 0) return false;
  const stripped = text.replace(/https?:\/\/\S+/gi, "").trim();
  return stripped.length < 12;
}

function guessLinkKind(url: string): "course" | "events" | "opportunity" | "other" {
  const hay = url.toLowerCase();
  if (/event|calendar|whats-on/.test(hay)) return "events";
  if (/job|career|intern|opportunit/.test(hay)) return "opportunity";
  if (/syllabus|course|canvas|learn/.test(hay)) return "course";
  return "other";
}

function progressTitle(tool?: string): string | undefined {
  if (tool === "search") return "Looking it up…";
  if (tool === "fetch") return "Reading your page…";
  if (tool === "agent") return "Opening it read-only…";
  return undefined;
}

/** Compatibility helper for the original proof and narrow integrations. */
export async function replyForText(text: string): Promise<string> {
  const local = parseCommand(text);
  if (local.kind === "echo") return `echo: ${local.text}`;
  if (local.kind === "diagnostic") {
    return local.action === "ping"
      ? "pong"
      : "Lodge’s message bridge is reachable. Send ECHO <words> for a local round-trip or START to begin.";
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

export { FIRSTROLE_URL };
