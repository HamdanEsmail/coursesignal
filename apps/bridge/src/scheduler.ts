import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { shouldDeliverWatch } from "../../../packages/provider-control/src/index.js";
import { LodgeAgent, type LodgeTinyFishPort } from "./agent.js";
import { numberEnvironment, optionalEnvironment, requiredEnvironment } from "./config.js";
import { formatHumanLocalTime } from "./grounding.js";
import { CourseSignalBridge } from "./handler.js";
import { opaqueIdentifier } from "./identifiers.js";
import { StructuredLogger, silentLogger } from "./logger.js";
import {
  createOpenRouterToolClientFromEnvironment,
  isLodgeModeEnabled,
  type LodgeModelClient,
} from "./openrouter.js";
import { createLodgeTinyFishPort, createTinyFishResearchService } from "./research.js";
import { createTinyFishRolesFinder } from "./tools.js";
import {
  LODGE_REOPEN_FAILED_HELP,
  SpaceRegistry,
  type LiveSpace,
  type SpaceReopener,
} from "./space-registry.js";
import { InMemoryBridgeStore, JsonFileBridgeStore } from "./store.js";
import { createSupabaseBridgeStore } from "./supabase-store.js";
import {
  LODGE_DEFAULT_QUIET_END,
  LODGE_DEFAULT_QUIET_START,
  LODGE_DEFAULT_TIMEZONE,
  type BridgeLogger,
  type BridgeOutboxStore,
  type BridgeStore,
  type ConversationMemory,
  type OutboxClaim,
  type OutboxEnqueueResult,
  type ResearchService,
  type SavedLink,
} from "./types.js";

export { LODGE_REOPEN_FAILED_HELP } from "./space-registry.js";

export const LODGE_SCHEDULER_TICK_MS = 30_000;
export const LODGE_DUE_SOON_MS = 24 * 60 * 60 * 1_000;
export const LODGE_PAGE_FETCH_MIN_INTERVAL_MS = 15 * 60 * 1_000;
export const FIRSTROLE_WORKSPACE_URL = "https://firstrole.hamdanesmail12-7a9.workers.dev";

const OUTBOX_BODY_MAX = 4_000;
const LOGICAL_KEY_MAX = 256;
const MAX_ATTEMPTS = 20;

export type RolesWatchHit = {
  url: string;
  company: string;
  title: string;
  stillOpen: "open" | "closed" | "unverified";
  reason?: string;
};

export type RolesWatchInput = {
  conversationKey: string;
  city?: string;
  knownUrls: string[];
};

export type RolesWatchFn = (input: RolesWatchInput) => Promise<RolesWatchHit[]>;

export type FetchReadableFn = (url: string) => Promise<{ text: string } | undefined>;

type OutboxRow = {
  messageId: string;
  conversationKey: string;
  logicalKey: string;
  payloadHash: string;
  body: string;
  state: "pending" | "claimed" | "sent" | "uncertain" | "failed";
  availableAt: number;
  claimToken?: string;
  claimedUntil?: number;
  attemptCount: number;
  providerMessageId?: string;
  errorCode?: string;
};

function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function clipLogicalKey(value: string): string {
  return value.length <= LOGICAL_KEY_MAX ? value : value.slice(0, LOGICAL_KEY_MAX);
}

function clipBody(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError("Outbox body is empty.");
  return trimmed.length <= OUTBOX_BODY_MAX ? trimmed : trimmed.slice(0, OUTBOX_BODY_MAX);
}

function zonedYmd(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

function conversationTimeZone(memory: ConversationMemory): string {
  return memory.timezone?.trim() || LODGE_DEFAULT_TIMEZONE;
}

export function reminderLogicalKey(id: string, fireAt: string): string {
  return clipLogicalKey(`reminder:${id}:${fireAt}`);
}

export function dueSoonLogicalKey(id: string, dueAt: string): string {
  return clipLogicalKey(`due-soon:${id}:${dueAt}`);
}

export function pageChangeLogicalKey(id: string, contentHash: string): string {
  return clipLogicalKey(`page-change:${id}:${contentHash}`);
}

export function rolesWatchLogicalKey(day: string): string {
  return clipLogicalKey(`roles:${day}`);
}

export function reopenHelpLogicalKey(day: string): string {
  return clipLogicalKey(`reopen-help:${day}`);
}

export function isProactivePaused(memory: ConversationMemory): boolean {
  return memory.watches.length > 0 && memory.watches.every((watch) => !watch.active);
}

export function readableContentHash(text: string): string {
  return sha256Utf8(text.replace(/\s+/g, " ").trim());
}

function watchQuietAllowed(memory: ConversationMemory, instant: Date): boolean {
  if (memory.quietHours?.enabled === false) return true;
  return shouldDeliverWatch({
    instant,
    timeZone: conversationTimeZone(memory),
    quietStart: memory.quietHours?.start ?? LODGE_DEFAULT_QUIET_START,
    quietEnd: memory.quietHours?.end ?? LODGE_DEFAULT_QUIET_END,
  }).deliver;
}

function knownOpportunityUrls(memory: ConversationMemory): string[] {
  const urls = new Set<string>();
  for (const note of memory.notebook ?? []) {
    if (note.kind === "opportunity" && note.url) urls.add(note.url);
  }
  for (const link of memory.savedLinks ?? []) {
    if (link.kind === "opportunity") urls.add(link.url);
  }
  return [...urls];
}

/**
 * In-process outbox that mirrors the SQL claim/sent/uncertain contract, including
 * unique (conversationKey, logicalKey) dedup.
 */
export class MemoryOutboxStore implements BridgeOutboxStore {
  readonly #rows = new Map<string, OutboxRow>();
  readonly #byLogical = new Map<string, string>();

  async enqueueOutbox(
    conversationKey: string,
    logicalKey: string,
    body: string,
    availableAt = new Date().toISOString(),
  ): Promise<OutboxEnqueueResult> {
    const safeKey = clipLogicalKey(logicalKey.trim());
    const safeBody = clipBody(body);
    if (!safeKey) throw new TypeError("logicalKey is empty.");
    const payloadHash = sha256Utf8(safeBody);
    const index = `${conversationKey}\0${safeKey}`;
    const existingId = this.#byLogical.get(index);
    if (existingId) {
      const existing = this.#rows.get(existingId);
      if (!existing) throw new TypeError("Outbox index is corrupt.");
      if (existing.payloadHash !== payloadHash || existing.body !== safeBody) {
        throw new TypeError("outbox logical key reused with a different payload");
      }
      return { messageId: existing.messageId, disposition: "duplicate" };
    }
    const messageId = randomUUID();
    this.#rows.set(messageId, {
      messageId,
      conversationKey,
      logicalKey: safeKey,
      payloadHash,
      body: safeBody,
      state: "pending",
      availableAt: Date.parse(availableAt) || Date.now(),
      attemptCount: 0,
    });
    this.#byLogical.set(index, messageId);
    return { messageId, disposition: "queued" };
  }

  async claimOutbox(workerId: string, limit = 10, leaseSeconds = 60): Promise<OutboxClaim[]> {
    if (!workerId.trim()) throw new TypeError("workerId is empty.");
    const capped = Math.min(100, Math.max(1, limit));
    const leaseMs = Math.min(3_600, Math.max(10, leaseSeconds)) * 1_000;
    const now = Date.now();
    const ready = [...this.#rows.values()]
      .filter((row) =>
        row.availableAt <= now
        && row.attemptCount < MAX_ATTEMPTS
        && (
          row.state === "pending"
          || (row.state === "claimed" && (row.claimedUntil ?? 0) <= now)
        )
      )
      .sort((left, right) => left.availableAt - right.availableAt)
      .slice(0, capped);

    return ready.map((row) => {
      row.state = "claimed";
      row.claimToken = randomUUID();
      row.claimedUntil = now + leaseMs;
      row.attemptCount += 1;
      return {
        messageId: row.messageId,
        principalId: row.conversationKey,
        conversationId: row.conversationKey,
        logicalKey: row.logicalKey,
        payloadHash: row.payloadHash,
        body: row.body,
        claimToken: row.claimToken,
        attemptCount: row.attemptCount,
      };
    });
  }

  async markOutboxSent(
    messageId: string,
    claimToken: string,
    providerMessageId: string,
  ): Promise<boolean> {
    const row = this.#rows.get(messageId);
    if (!row || row.state !== "claimed" || row.claimToken !== claimToken) return false;
    row.state = "sent";
    row.providerMessageId = providerMessageId;
    row.claimToken = undefined;
    row.claimedUntil = undefined;
    return true;
  }

  async markOutboxUncertain(
    messageId: string,
    claimToken: string,
    errorCode: string,
  ): Promise<boolean> {
    const row = this.#rows.get(messageId);
    if (!row || row.state !== "claimed" || row.claimToken !== claimToken) return false;
    row.state = "uncertain";
    row.errorCode = errorCode.slice(0, 80);
    row.claimToken = undefined;
    row.claimedUntil = undefined;
    return true;
  }

  /** Return a claimed row to pending so a later live space can deliver it. */
  async retryLater(messageId: string, claimToken: string): Promise<boolean> {
    const row = this.#rows.get(messageId);
    if (!row || row.state !== "claimed" || row.claimToken !== claimToken) return false;
    row.state = "pending";
    row.claimToken = undefined;
    row.claimedUntil = undefined;
    return true;
  }
}

function isRetryableOutbox(store: BridgeOutboxStore): store is MemoryOutboxStore {
  return store instanceof MemoryOutboxStore;
}

/** Remembers conversation keys seen through get/put so the scheduler can scan after restart. */
export class TrackingBridgeStore implements BridgeStore {
  readonly #inner: BridgeStore;
  readonly #keys: Set<string>;

  constructor(inner: BridgeStore, keys: Iterable<string> = []) {
    this.#inner = inner;
    this.#keys = new Set(keys);
  }

  remember(conversationKey: string): void {
    this.#keys.add(conversationKey);
  }

  async listConversationKeys(): Promise<string[]> {
    return [...this.#keys];
  }

  async claimInbound(eventKey: string, receivedAt: string) {
    return this.#inner.claimInbound(eventKey, receivedAt);
  }

  async completeInbound(eventKey: string, claimToken: string) {
    await this.#inner.completeInbound(eventKey, claimToken);
  }

  async releaseInbound(eventKey: string, claimToken: string) {
    await this.#inner.releaseInbound(eventKey, claimToken);
  }

  async getConversation(conversationKey: string) {
    const memory = await this.#inner.getConversation(conversationKey);
    if (memory) this.#keys.add(conversationKey);
    return memory;
  }

  async putConversation(conversationKey: string, memory: ConversationMemory) {
    this.#keys.add(conversationKey);
    await this.#inner.putConversation(conversationKey, memory);
  }

  async deleteConversation(conversationKey: string) {
    this.#keys.delete(conversationKey);
    await this.#inner.deleteConversation(conversationKey);
  }

  async close() {
    await this.#inner.close?.();
  }
}

export async function seedConversationKeysFromJsonFile(
  path: string,
  store: TrackingBridgeStore,
): Promise<void> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      conversations?: Record<string, unknown>;
    };
    for (const key of Object.keys(parsed.conversations ?? {})) store.remember(key);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return;
  }
}

export type LodgeSchedulerOptions = {
  store: TrackingBridgeStore | BridgeStore;
  outbox: BridgeOutboxStore;
  spaces: SpaceRegistry;
  logger?: BridgeLogger;
  now?: () => Date;
  workerId?: string;
  tickIntervalMs?: number;
  claimLimit?: number;
  leaseSeconds?: number;
  pageFetchMinIntervalMs?: number;
  dueSoonMs?: number;
  fetchReadable?: FetchReadableFn;
  runRolesWatch?: RolesWatchFn;
  reopenSpace?: SpaceReopener;
};

export class LodgeScheduler {
  readonly #store: BridgeStore;
  readonly #outbox: BridgeOutboxStore;
  readonly #spaces: SpaceRegistry;
  readonly #logger: BridgeLogger;
  readonly #now: () => Date;
  readonly #workerId: string;
  readonly #tickIntervalMs: number;
  readonly #claimLimit: number;
  readonly #leaseSeconds: number;
  readonly #pageFetchMinIntervalMs: number;
  readonly #dueSoonMs: number;
  readonly #fetchReadable: FetchReadableFn | undefined;
  readonly #runRolesWatch: RolesWatchFn | undefined;
  readonly #reopenFailed = new Set<string>();
  readonly #helpSent = new Set<string>();
  #reopenSpace: SpaceReopener | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;
  #ticking = false;

  constructor(options: LodgeSchedulerOptions) {
    this.#store = options.store;
    this.#outbox = options.outbox;
    this.#spaces = options.spaces;
    this.#logger = options.logger ?? silentLogger;
    this.#now = options.now ?? (() => new Date());
    this.#workerId = options.workerId ?? "lodge-scheduler";
    this.#tickIntervalMs = options.tickIntervalMs ?? LODGE_SCHEDULER_TICK_MS;
    this.#claimLimit = options.claimLimit ?? 20;
    this.#leaseSeconds = options.leaseSeconds ?? 60;
    this.#pageFetchMinIntervalMs = options.pageFetchMinIntervalMs ?? LODGE_PAGE_FETCH_MIN_INTERVAL_MS;
    this.#dueSoonMs = options.dueSoonMs ?? LODGE_DUE_SOON_MS;
    this.#fetchReadable = options.fetchReadable;
    this.#runRolesWatch = options.runRolesWatch;
    this.#reopenSpace = options.reopenSpace;
    this.#spaces.setOnLive((conversationKey) => this.#onLive(conversationKey));
  }

  setReopen(reopenSpace: SpaceReopener | undefined): void {
    this.#reopenSpace = reopenSpace;
  }

  start(signal?: AbortSignal): void {
    if (this.#timer) return;
    const onAbort = (): void => this.stop();
    signal?.addEventListener("abort", onAbort, { once: true });
    this.#timer = setInterval(() => {
      void this.tick();
    }, this.#tickIntervalMs);
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.#ticking) return;
    this.#ticking = true;
    try {
      await this.#scanAndEnqueue();
      await this.#claimAndDeliver();
    } catch (error) {
      this.#logger.error("scheduler.tick_failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
    } finally {
      this.#ticking = false;
    }
  }

  async #onLive(conversationKey: string): Promise<void> {
    if (!this.#reopenFailed.has(conversationKey) || this.#helpSent.has(conversationKey)) return;
    const now = this.#now();
    const memory = await this.#store.getConversation(conversationKey);
    const day = zonedYmd(now, conversationTimeZone(memory ?? {
      courses: [],
      watches: [],
      updatedAt: now.toISOString(),
    }));
    await this.#enqueue(conversationKey, reopenHelpLogicalKey(day), LODGE_REOPEN_FAILED_HELP);
    this.#helpSent.add(conversationKey);
    this.#reopenFailed.delete(conversationKey);
  }

  async #listKeys(): Promise<string[]> {
    const keys = new Set(this.#spaces.conversationKeys());
    const listing = this.#store as BridgeStore & {
      listConversationKeys?: () => Promise<string[]>;
    };
    if (typeof listing.listConversationKeys === "function") {
      for (const key of await listing.listConversationKeys()) keys.add(key);
    }
    return [...keys];
  }

  async #scanAndEnqueue(): Promise<void> {
    const now = this.#now();
    for (const conversationKey of await this.#listKeys()) {
      const memory = await this.#store.getConversation(conversationKey);
      if (!memory?.consentedAt) continue;
      const dirty = await this.#enqueueForConversation(conversationKey, memory, now);
      if (dirty) {
        memory.updatedAt = now.toISOString();
        await this.#store.putConversation(conversationKey, memory);
      }
    }
  }

  async #enqueueForConversation(
    conversationKey: string,
    memory: ConversationMemory,
    now: Date,
  ): Promise<boolean> {
    let dirty = false;
    dirty = await this.#enqueueReminders(conversationKey, memory, now) || dirty;
    if (isProactivePaused(memory)) return dirty;
    if (!watchQuietAllowed(memory, now)) return dirty;
    dirty = await this.#enqueueDueSoon(conversationKey, memory, now) || dirty;
    dirty = await this.#enqueuePageChanges(conversationKey, memory, now) || dirty;
    dirty = await this.#enqueueRolesWatch(conversationKey, memory, now) || dirty;
    return dirty;
  }

  async #enqueueReminders(
    conversationKey: string,
    memory: ConversationMemory,
    now: Date,
  ): Promise<boolean> {
    let dirty = false;
    const zone = conversationTimeZone(memory);
    for (const reminder of memory.pendingReminders ?? []) {
      if (reminder.status !== "scheduled" && reminder.status !== "snoozed") continue;
      const fireAt = reminder.status === "snoozed" && reminder.snoozeUntil
        ? reminder.snoozeUntil
        : reminder.fireAt;
      if (Date.parse(fireAt) > now.getTime()) continue;
      if (!reminder.ignoreQuietHours && !watchQuietAllowed(memory, now)) continue;
      const when = reminder.localFireLabel ?? formatHumanLocalTime(fireAt, zone, now);
      const body = reminder.text.trim()
        ? `Reminder: ${reminder.text.trim()} (${when}).`
        : `Reminder (${when}).`;
      const queued = await this.#enqueue(
        conversationKey,
        reminderLogicalKey(reminder.id, fireAt),
        body,
        new Date().toISOString(),
      );
      if (queued) {
        reminder.status = "fired";
        dirty = true;
      }
    }
    return dirty;
  }

  async #enqueueDueSoon(
    conversationKey: string,
    memory: ConversationMemory,
    now: Date,
  ): Promise<boolean> {
    const zone = conversationTimeZone(memory);
    const horizon = now.getTime() + this.#dueSoonMs;
    const floor = now.getTime() - 60 * 60 * 1_000;
    for (const note of memory.notebook ?? []) {
      if (note.kind !== "deadline" || !note.dueAt) continue;
      const due = Date.parse(note.dueAt);
      if (!Number.isFinite(due) || due < floor || due > horizon) continue;
      const when = formatHumanLocalTime(note.dueAt, zone, now);
      const title = note.text.trim() || "A deadline";
      await this.#enqueue(
        conversationKey,
        dueSoonLogicalKey(note.id, note.dueAt),
        `${title} is due ${when}.`,
      );
    }
    return false;
  }

  async #enqueuePageChanges(
    conversationKey: string,
    memory: ConversationMemory,
    now: Date,
  ): Promise<boolean> {
    if (!this.#fetchReadable) return false;
    let dirty = false;
    const nowIso = now.toISOString();
    const nowMs = now.getTime();
    for (const link of memory.savedLinks ?? []) {
      if (!link.watchEnabled) continue;
      if (recentlyFetched(link, nowMs, this.#pageFetchMinIntervalMs)) continue;
      let page: { text: string } | undefined;
      try {
        page = await this.#fetchReadable(link.url);
      } catch (error) {
        this.#logger.warn("scheduler.page_fetch_failed", {
          errorType: error instanceof Error ? error.name : typeof error,
        });
        link.lastFetchedAt = nowIso;
        dirty = true;
        continue;
      }
      link.lastFetchedAt = nowIso;
      dirty = true;
      const text = page?.text?.replace(/\s+/g, " ").trim();
      if (!text) continue;
      const hash = readableContentHash(text);
      if (!link.contentHash) {
        link.contentHash = hash;
        continue;
      }
      if (link.contentHash === hash) continue;
      link.contentHash = hash;
      link.lastChangedAt = nowIso;
      const label = link.title?.trim() || kindLabel(link.kind);
      await this.#enqueue(
        conversationKey,
        pageChangeLogicalKey(link.id, hash),
        `Your ${label} page posted a new deadline or update.\n${link.url}`,
      );
    }
    return dirty;
  }

  async #enqueueRolesWatch(
    conversationKey: string,
    memory: ConversationMemory,
    now: Date,
  ): Promise<boolean> {
    if (!memory.rolesOptIn || !this.#runRolesWatch) return false;
    const zone = conversationTimeZone(memory);
    const day = zonedYmd(now, zone);
    if (memory.lastRolesWatchAt && zonedYmd(new Date(memory.lastRolesWatchAt), zone) === day) {
      return false;
    }
    let hits: RolesWatchHit[] = [];
    try {
      hits = await this.#runRolesWatch({
        conversationKey,
        city: memory.rolesCity,
        knownUrls: knownOpportunityUrls(memory),
      });
    } catch (error) {
      this.#logger.warn("scheduler.roles_watch_failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
      return false;
    }
    memory.lastRolesWatchAt = now.toISOString();
    const known = new Set(knownOpportunityUrls(memory));
    const fresh = hits.filter((hit) =>
      hit.stillOpen === "open" && hit.url.startsWith("https://") && !known.has(hit.url)
    ).slice(0, 3);
    if (fresh.length === 0) return true;
    const lines = fresh.map((hit) =>
      `${hit.company} — ${hit.title}${hit.reason ? ` (${hit.reason})` : ""}\n${hit.url}`
    );
    lines.push(`Full shortlist on FirstRole: ${FIRSTROLE_WORKSPACE_URL}`);
    const city = memory.rolesCity?.trim();
    const header = city
      ? `New verified opening in ${city}:`
      : "New verified opening:";
    await this.#enqueue(
      conversationKey,
      rolesWatchLogicalKey(day),
      `${header}\n${lines.join("\n")}`,
    );
    return true;
  }

  async #enqueue(
    conversationKey: string,
    logicalKey: string,
    body: string,
    availableAt?: string,
  ): Promise<boolean> {
    try {
      const result = await this.#outbox.enqueueOutbox(
        conversationKey,
        logicalKey,
        body,
        availableAt,
      );
      return result.disposition === "queued" || result.disposition === "duplicate";
    } catch (error) {
      this.#logger.warn("scheduler.enqueue_failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
      return false;
    }
  }

  async #claimAndDeliver(): Promise<void> {
    const claims = await this.#outbox.claimOutbox(
      this.#workerId,
      this.#claimLimit,
      this.#leaseSeconds,
    );
    for (const claim of claims) {
      await this.#deliver(claim);
    }
  }

  async #deliver(claim: OutboxClaim): Promise<void> {
    const conversationKey = claim.conversationId;
    const memory = await this.#store.getConversation(conversationKey);
    let space: LiveSpace | undefined;
    try {
      space = await this.#spaces.reopen(conversationKey, memory, this.#reopenSpace);
    } catch {
      space = undefined;
    }
    if (!space) {
      this.#reopenFailed.add(conversationKey);
      this.#logger.warn("scheduler.space_unavailable", {
        conversationRef: this.#logger.ref(conversationKey),
      });
      if (isRetryableOutbox(this.#outbox)) {
        await this.#outbox.retryLater(claim.messageId, claim.claimToken);
        return;
      }
      await this.#outbox.markOutboxUncertain(
        claim.messageId,
        claim.claimToken,
        "SPACE_UNAVAILABLE",
      );
      return;
    }
    try {
      const sent = await space.send(claim.body);
      const providerMessageId = sent?.messageId?.trim() || `outbox:${claim.messageId}`;
      await this.#outbox.markOutboxSent(claim.messageId, claim.claimToken, providerMessageId);
    } catch (error) {
      this.#logger.warn("scheduler.send_failed", {
        errorType: error instanceof Error ? error.name : typeof error,
        conversationRef: this.#logger.ref(conversationKey),
      });
      await this.#outbox.markOutboxUncertain(
        claim.messageId,
        claim.claimToken,
        "SEND_FAILED",
      );
    }
  }
}

export function createLodgeScheduler(options: LodgeSchedulerOptions): LodgeScheduler {
  return new LodgeScheduler(options);
}

function recentlyFetched(link: SavedLink, nowMs: number, minIntervalMs: number): boolean {
  if (!link.lastFetchedAt) return false;
  const fetched = Date.parse(link.lastFetchedAt);
  return Number.isFinite(fetched) && nowMs - fetched < minIntervalMs;
}

function kindLabel(kind: SavedLink["kind"]): string {
  if (kind === "course") return "course";
  if (kind === "events") return "events";
  if (kind === "opportunity") return "roles";
  return "saved";
}

function outboxFromStore(store: BridgeStore): BridgeOutboxStore | undefined {
  const candidate = store as BridgeStore & Partial<BridgeOutboxStore>;
  if (
    typeof candidate.enqueueOutbox === "function"
    && typeof candidate.claimOutbox === "function"
    && typeof candidate.markOutboxSent === "function"
    && typeof candidate.markOutboxUncertain === "function"
  ) {
    return candidate as BridgeOutboxStore;
  }
  return undefined;
}

function resolveStatePath(stateSecret: string): string {
  const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const configuredStatePath = optionalEnvironment("COURSESIGNAL_STATE_PATH");
  if (configuredStatePath) {
    return isAbsolute(configuredStatePath) ? configuredStatePath : resolve(workspaceRoot, configuredStatePath);
  }
  return join(
    workspaceRoot,
    "private-handoff",
    `bridge-state-v1-${opaqueIdentifier(
      "deployment",
      optionalEnvironment("SPECTRUM_PROJECT_ID") ?? "local",
      stateSecret,
    ).slice(0, 12)}.json`,
  );
}

export type LodgeBridgeStack = {
  store: TrackingBridgeStore;
  outbox: BridgeOutboxStore;
  logger: StructuredLogger;
  bridge: CourseSignalBridge;
  spaces: SpaceRegistry;
  scheduler: LodgeScheduler;
  jsonStatePath?: string;
  /** True only when LODGE_MODE is on. Default is off so Azure stays on the old path. */
  lodgeMode: boolean;
};

export type LodgeBridgeStackOptions = {
  stateSecret: string;
  durable?: boolean;
  fetchReadable?: FetchReadableFn;
  runRolesWatch?: RolesWatchFn;
  research?: ResearchService;
  tinyfish?: LodgeTinyFishPort;
  modelClient?: LodgeModelClient;
  debounceMs?: number;
  /** Test override. Production reads LODGE_MODE (default off). */
  lodgeMode?: boolean;
};

/** One store, one Spectrum/terminal process. The scheduler never starts a second listener. */
export async function createLodgeBridgeStack(
  options: LodgeBridgeStackOptions,
): Promise<LodgeBridgeStack> {
  const logger = new StructuredLogger({
    secret: options.stateSecret,
    minimum: optionalEnvironment("COURSESIGNAL_LOG_LEVEL") === "debug" ? "debug" :
      optionalEnvironment("COURSESIGNAL_LOG_LEVEL") === "error" ? "error" :
        optionalEnvironment("COURSESIGNAL_LOG_LEVEL") === "warn" ? "warn" : "info",
  });
  const backend = optionalEnvironment("COURSESIGNAL_STORE")?.toLowerCase() ?? "json";
  if (backend !== "json" && backend !== "supabase") {
    throw new Error("COURSESIGNAL_STORE must be either json or supabase.");
  }
  let jsonStatePath: string | undefined;
  let inner: BridgeStore;
  if (options.durable === false) {
    inner = new InMemoryBridgeStore();
  } else if (backend === "supabase") {
    inner = createSupabaseBridgeStore(
      requiredEnvironment("SUPABASE_URL"),
      requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    );
  } else {
    jsonStatePath = resolveStatePath(options.stateSecret);
    inner = new JsonFileBridgeStore(jsonStatePath);
  }
  const store = new TrackingBridgeStore(inner);
  if (jsonStatePath) await seedConversationKeysFromJsonFile(jsonStatePath, store);
  const outbox = outboxFromStore(inner) ?? new MemoryOutboxStore();
  const spaces = new SpaceRegistry({ wrapSecret: options.stateSecret, store, now: () => new Date() });
  const lodgeMode = options.lodgeMode ?? isLodgeModeEnabled();
  const research = options.research ?? createTinyFishResearchService();
  const debounceMs = options.debounceMs ?? numberEnvironment("COURSESIGNAL_DEBOUNCE_MS", 300);
  if (!lodgeMode) {
    const scheduler = createLodgeScheduler({
      store,
      outbox,
      spaces,
      logger,
      fetchReadable: options.fetchReadable,
      runRolesWatch: options.runRolesWatch,
    });
    const bridge = new CourseSignalBridge({
      store,
      research,
      logger,
      debounceMs,
    });
    return { store, outbox, logger, bridge, spaces, scheduler, jsonStatePath, lodgeMode };
  }

  const tinyfish = options.tinyfish ?? createLodgeTinyFishPort();
  const roles = createTinyFishRolesFinder(tinyfish);
  const modelClient = options.modelClient ?? createOpenRouterToolClientFromEnvironment();
  const scheduler = createLodgeScheduler({
    store,
    outbox,
    spaces,
    logger,
    fetchReadable: options.fetchReadable ?? (async (url) => {
      try {
        const page = await tinyfish.fetch(url);
        return { text: page.text };
      } catch {
        return undefined;
      }
    }),
    runRolesWatch: options.runRolesWatch ?? (async (input) => {
      const listings = await roles.findRoles({
        query: "internship",
        city: input.city?.trim() || "",
      });
      return listings.map((listing) => ({
        url: listing.url,
        company: listing.company,
        title: listing.title,
        stillOpen: listing.stillOpen ?? "unverified",
        reason: listing.matchReason,
      }));
    }),
  });
  const bridge = new CourseSignalBridge({
    store,
    research,
    logger,
    debounceMs,
    tinyfish,
    roles,
    createAgent: modelClient
      ? (localTools) => new LodgeAgent({
        client: modelClient,
        tinyfish,
        localTools,
      })
      : undefined,
  });
  return { store, outbox, logger, bridge, spaces, scheduler, jsonStatePath, lodgeMode };
}
