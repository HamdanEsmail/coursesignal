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

export interface ConversationPort {
  send(body: string): Promise<void>;
  startTyping?(): Promise<void>;
  stopTyping?(): Promise<void>;
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

export type ConversationMemory = {
  consentedAt?: string;
  consentVersion?: 2 | 3;
  courses: string[];
  activeCourse?: string;
  lastResearch?: LastResearchMemory;
  watches: WatchMemory[];
  forgetRequestedAt?: string;
  updatedAt: string;
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
