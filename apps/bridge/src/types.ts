export type ResearchMode = "answer" | "plan";

export type EvidenceSource = {
  title: string;
  url: string;
  excerpt: string;
  endpoint: "search" | "fetch" | "agent";
};

export type ResearchRequest = {
  query: string;
  mode: ResearchMode;
  course?: string;
};

export type ResearchResult = {
  body: string;
  endpoints: Array<"search" | "fetch" | "agent">;
  sourceUrls: string[];
  sources: EvidenceSource[];
  checkedAt: string;
};

export interface ResearchService {
  research(request: ResearchRequest): Promise<ResearchResult>;
}

export type HandleDisposition = "accepted" | "duplicate" | "state-unavailable";

export type InboundContent =
  | { type: "text"; text: string }
  | { type: "unsupported"; kind: string };

export type InboundEnvelope = {
  eventKey: string;
  conversationKey: string;
  senderKey?: string;
  receivedAt: string;
  content: InboundContent;
};

/** ❤️ pin / calendar, 👍 done, 👎 stop, ❓ explain. */
export type ConversationReaction = "love" | "like" | "dislike" | "question";

/** Public slip URL only. No conversation keys, phones, or names. */
export type LodgeAppCard = {
  url: string;
  title?: string;
};

export type LodgePoll = {
  question: string;
  /** At least two choices. */
  options: string[];
};

export type LodgeRichLink = {
  url: string;
  title?: string;
};

export interface ConversationPort {
  send(body: string): Promise<void>;
  startTyping?(): Promise<void>;
  stopTyping?(): Promise<void>;
  /** Wave 2 Photon craft. Optional so current adapters still compile. */
  react?(targetMessageId: string, reaction: ConversationReaction): Promise<void>;
  reply?(body: string, replyToMessageId: string): Promise<void>;
  edit?(messageId: string, body: string): Promise<void>;
  unsend?(messageId: string): Promise<void>;
  sendApp?(card: LodgeAppCard): Promise<{ messageId?: string } | void>;
  sendPoll?(poll: LodgePoll): Promise<void>;
  sendRichLink?(link: LodgeRichLink): Promise<void>;
}

export type WatchMemory = {
  id: string;
  target: string;
  course?: string;
  createdAt: string;
  active: boolean;
};

export type LastResearchMemory = {
  query: string;
  /** Standing subject. Short follow-ups reuse it; a new question replaces it. */
  topic?: string;
  mode: ResearchMode;
  course?: string;
  checkedAt: string;
  endpoints: Array<"search" | "fetch" | "agent">;
  sources: EvidenceSource[];
};

/** 2/3 remain readable when LODGE_MODE is off. 4 is current Lodge consent. */
export type ConsentVersion = 2 | 3 | 4;

export const LODGE_CONSENT_VERSION = 4 as const;
export const LODGE_NOTEBOOK_CAP = 30;
export const LODGE_SAVED_LINKS_CAP = 20;
export const LODGE_PENDING_REMINDERS_CAP = 20;
export const LODGE_TRACE_STEPS_CAP = 12;
export const LODGE_DEFAULT_TIMEZONE = "Asia/Dubai";
export const LODGE_DEFAULT_QUIET_START = "22:00";
export const LODGE_DEFAULT_QUIET_END = "08:00";

export type LodgeLinkKind = "course" | "events" | "opportunity" | "other";

export type NotebookNoteKind = "deadline" | "event" | "opportunity" | "reminder" | "freeform";

export type LodgeCheckInStep = "school" | "course_page" | "events_page" | "roles" | "done";

export type QuietHoursMemory = {
  /** Local HH:MM. Default 22:00. */
  start: string;
  /** Local HH:MM. Default 08:00. */
  end: string;
  enabled: boolean;
};

export type SavedLink = {
  id: string;
  kind: LodgeLinkKind;
  url: string;
  title?: string;
  createdAt: string;
  /** SHA-256 of last fetched readable text. Opt-in page-change watch. */
  contentHash?: string;
  lastFetchedAt?: string;
  lastChangedAt?: string;
  watchEnabled?: boolean;
};

type NotebookNoteBase = {
  id: string;
  text: string;
  createdAt: string;
  url?: string;
};

export type DeadlineNote = NotebookNoteBase & {
  kind: "deadline";
  dueAt?: string;
};

export type EventNote = NotebookNoteBase & {
  kind: "event";
  startsAt?: string;
  endsAt?: string;
  where?: string;
};

export type OpportunityNote = NotebookNoteBase & {
  kind: "opportunity";
  company?: string;
  listingTitle?: string;
  applied: boolean;
  appliedAt?: string;
};

export type ReminderNote = NotebookNoteBase & {
  kind: "reminder";
  remindAt?: string;
};

export type FreeformNote = NotebookNoteBase & {
  kind: "freeform";
};

export type NotebookNote =
  | DeadlineNote
  | EventNote
  | OpportunityNote
  | ReminderNote
  | FreeformNote;

export type PendingReminderStatus =
  | "pending_confirm"
  | "scheduled"
  | "fired"
  | "done"
  | "snoozed"
  | "cancelled";

export type PendingReminder = {
  id: string;
  text: string;
  fireAt: string;
  createdAt: string;
  status: PendingReminderStatus;
  /** You-asked wake-ups ignore corridor quiet hours. */
  ignoreQuietHours: boolean;
  localFireLabel?: string;
  snoozeUntil?: string;
  confirmedAt?: string;
};

export type LodgeTraceTool = "search" | "fetch" | "agent";

export type LodgeTraceStep = {
  tool: LodgeTraceTool;
  label?: string;
  url?: string;
  durationMs?: number;
  outcome: "ok" | "named_failure";
  failure?: string;
};

export type LastTraceMemory = {
  at: string;
  steps: LodgeTraceStep[];
  checkedLive: boolean;
};

/**
 * Ciphertext of the Photon space handle for reopen-after-restart.
 * Never a raw space id, phone, or conversation key.
 */
export type EncryptedSpaceHandle = {
  version: 1;
  ciphertext: string;
  wrappedAt: string;
};

export type PendingRememberPage = {
  url: string;
  kind?: LodgeLinkKind;
  title?: string;
  excerpt?: string;
  offeredAt: string;
};

export type ConversationMemory = {
  consentedAt?: string;
  consentVersion?: ConsentVersion;
  /** Kept so the previous handler still typechecks when LODGE_MODE is off. */
  courses: string[];
  activeCourse?: string;
  lastResearch?: LastResearchMemory;
  watches: WatchMemory[];
  forgetRequestedAt?: string;
  updatedAt: string;
  school?: string;
  timezone?: string;
  quietHours?: QuietHoursMemory;
  savedLinks?: SavedLink[];
  notebook?: NotebookNote[];
  pendingReminders?: PendingReminder[];
  lastTrace?: LastTraceMemory;
  encryptedSpaceHandle?: EncryptedSpaceHandle;
  pendingRememberPage?: PendingRememberPage;
  rolesCity?: string;
  rolesOptIn?: boolean;
  checkInStep?: LodgeCheckInStep;
  checkInCompletedAt?: string;
  checkInSkippedAt?: string;
  lastRolesWatchAt?: string;
};

export type InboundClaimToken = string;

export interface BridgeStore {
  /** Atomically leases an opaque provider event key. Undefined means it is already handled or leased. */
  claimInbound(eventKey: string, receivedAt: string): Promise<InboundClaimToken | undefined>;
  /** A stale worker cannot complete or release a newer worker's lease. */
  completeInbound(eventKey: string, claimToken: InboundClaimToken): Promise<void>;
  releaseInbound(eventKey: string, claimToken: InboundClaimToken): Promise<void>;
  getConversation(conversationKey: string): Promise<ConversationMemory | undefined>;
  putConversation(conversationKey: string, memory: ConversationMemory): Promise<void>;
  deleteConversation(conversationKey: string): Promise<void>;
  close?(): Promise<void>;
}

export type OutboxEnqueueResult = {
  messageId: string;
  disposition: "queued" | "duplicate";
};

export type OutboxClaim = {
  messageId: string;
  principalId: string;
  conversationId: string;
  logicalKey: string;
  payloadHash: string;
  body: string;
  claimToken: string;
  attemptCount: number;
};

/**
 * Persistence boundary for the normalized outbound queue. Delivery workers,
 * not message handlers, own claim/send/finalize sequencing.
 */
export interface BridgeOutboxStore {
  enqueueOutbox(
    conversationKey: string,
    logicalKey: string,
    body: string,
    availableAt?: string,
  ): Promise<OutboxEnqueueResult>;
  claimOutbox(workerId: string, limit?: number, leaseSeconds?: number): Promise<OutboxClaim[]>;
  markOutboxSent(messageId: string, claimToken: string, providerMessageId: string): Promise<boolean>;
  markOutboxUncertain(messageId: string, claimToken: string, errorCode: string): Promise<boolean>;
}

export interface BridgeLogger {
  ref(value: string): string;
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}
