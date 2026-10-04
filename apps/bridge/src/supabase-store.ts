import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type {
  BridgeOutboxStore,
  BridgeStore,
  ConversationMemory,
  OutboxClaim,
  OutboxEnqueueResult,
} from "./types.js";

type RpcError = {
  code?: string;
  message?: string;
};

type RpcResult = {
  data: unknown;
  error: RpcError | null;
};

/** Small injectable surface so unit tests never contact a Supabase project. */
export interface SupabaseRpcClient {
  rpc(functionName: string, parameters?: Record<string, unknown>): PromiseLike<RpcResult>;
}

const opaqueKeySchema = z.string().regex(/^[0-9a-f]{64}$/);
const uuidSchema = z.uuid();
const timestampSchema = z.iso.datetime({ offset: true });
const endpointSchema = z.enum(["search", "fetch", "agent"]);

const evidenceSourceSchema = z.object({
  title: z.string().min(1).max(500),
  url: z.url(),
  excerpt: z.string().max(10_000),
  endpoint: endpointSchema,
}).strict();

const watchMemorySchema = z.object({
  id: uuidSchema,
  target: z.string().min(1).max(500),
  course: z.string().min(1).max(80).optional(),
  createdAt: timestampSchema,
  active: z.boolean(),
}).strict();

const lastResearchMemorySchema = z.object({
  query: z.string().min(1).max(1_200),
  topic: z.string().min(1).max(240).optional(),
  mode: z.enum(["answer", "plan"]),
  course: z.string().min(1).max(80).optional(),
  checkedAt: timestampSchema,
  endpoints: z.array(endpointSchema).max(3),
  sources: z.array(evidenceSourceSchema).max(5),
}).strict();

const conversationMemorySchema: z.ZodType<ConversationMemory> = z.object({
  consentedAt: timestampSchema.optional(),
  consentVersion: z.union([z.literal(2), z.literal(3)]).optional(),
  courses: z.array(z.string().min(1).max(80)).max(8),
  activeCourse: z.string().min(1).max(80).optional(),
  lastResearch: lastResearchMemorySchema.optional(),
  watches: z.array(watchMemorySchema).max(5),
  forgetRequestedAt: timestampSchema.optional(),
  updatedAt: timestampSchema,
}).strict();

const outboxEnqueueRowsSchema = z.array(z.object({
  message_id: uuidSchema,
  disposition: z.enum(["queued", "duplicate"]),
}).strict()).length(1);

const outboxClaimRowsSchema = z.array(z.object({
  message_id: uuidSchema,
  principal_id: uuidSchema,
  conversation_id: uuidSchema,
  logical_key: z.string().min(1).max(256),
  payload_hash: z.string().regex(/^[0-9a-f]{64}$/),
  body: z.string().min(1).max(4_000),
  claim_token: uuidSchema,
  attempt_count: z.number().int().min(1).max(20),
}).strict());

export class SupabaseBridgeStoreError extends Error {
  readonly operation: string;
  readonly code?: string;

  constructor(operation: string, code?: string) {
    const safeCode = code?.match(/^[a-z0-9_-]{1,32}$/i)?.[0];
    super(`Supabase bridge persistence failed during ${operation}${safeCode ? ` (${safeCode})` : ""}.`);
    this.name = "SupabaseBridgeStoreError";
    this.operation = operation;
    this.code = safeCode;
  }
}

export type SupabaseBridgeStoreOptions = {
  leaseSeconds?: number;
  dedupRetentionSeconds?: number;
};

/**
 * Server-only Supabase adapter for bridge runtime state and the canonical
 * normalized outbox. It never accepts raw provider identifiers: keys must be
 * lowercase HMAC-SHA256 digests produced at the Photon edge.
 */
export class SupabaseBridgeStore implements BridgeStore, BridgeOutboxStore {
  readonly #client: SupabaseRpcClient;
  readonly #leaseSeconds: number;
  readonly #dedupRetentionSeconds: number;

  constructor(client: SupabaseRpcClient, options: SupabaseBridgeStoreOptions = {}) {
    this.#client = client;
    this.#leaseSeconds = integerInRange(options.leaseSeconds ?? 300, 10, 3600, "leaseSeconds");
    this.#dedupRetentionSeconds = integerInRange(
      options.dedupRetentionSeconds ?? 7 * 24 * 60 * 60,
      60,
      365 * 24 * 60 * 60,
      "dedupRetentionSeconds",
    );
  }

  async claimInbound(eventKey: string, receivedAt: string): Promise<string | undefined> {
    const key = opaqueKey(eventKey, "eventKey");
    const timestamp = timestampSchema.parse(receivedAt);
    const data = await this.#rpc("claim inbound", "claim_bridge_inbound", {
      p_event_key: key,
      p_received_at: timestamp,
      p_lease_seconds: this.#leaseSeconds,
      p_retention_seconds: this.#dedupRetentionSeconds,
    });
    return data === null ? undefined : uuidSchema.parse(data);
  }

  async completeInbound(eventKey: string, claimToken: string): Promise<void> {
    const completed = z.boolean().parse(await this.#rpc(
      "complete inbound",
      "complete_bridge_inbound",
      {
        p_event_key: opaqueKey(eventKey, "eventKey"),
        p_lease_token: uuidSchema.parse(claimToken),
      },
    ));
    if (!completed) throw new SupabaseBridgeStoreError("complete inbound", "lease_lost");
  }

  async releaseInbound(eventKey: string, claimToken: string): Promise<void> {
    const released = z.boolean().parse(await this.#rpc(
      "release inbound",
      "release_bridge_inbound",
      {
        p_event_key: opaqueKey(eventKey, "eventKey"),
        p_lease_token: uuidSchema.parse(claimToken),
      },
    ));
    if (!released) throw new SupabaseBridgeStoreError("release inbound", "lease_lost");
  }

  async getConversation(conversationKey: string): Promise<ConversationMemory | undefined> {
    const data = await this.#rpc("get conversation", "get_bridge_runtime_state", {
      p_conversation_key: opaqueKey(conversationKey, "conversationKey"),
    });
    return data === null ? undefined : structuredClone(conversationMemorySchema.parse(data));
  }

  async putConversation(conversationKey: string, memory: ConversationMemory): Promise<void> {
    const validated = structuredClone(conversationMemorySchema.parse(memory));
    await this.#rpc("put conversation", "put_bridge_runtime_state", {
      p_conversation_key: opaqueKey(conversationKey, "conversationKey"),
      p_memory: validated,
    });
  }

  async deleteConversation(conversationKey: string): Promise<void> {
    z.boolean().parse(await this.#rpc("delete conversation", "delete_bridge_runtime_state", {
      p_conversation_key: opaqueKey(conversationKey, "conversationKey"),
    }));
  }

  async enqueueOutbox(
    conversationKey: string,
    logicalKey: string,
    body: string,
    availableAt = new Date().toISOString(),
  ): Promise<OutboxEnqueueResult> {
    const safeLogicalKey = boundedString(logicalKey, 1, 256, "logicalKey");
    const safeBody = boundedString(body, 1, 4_000, "body");
    const rows = outboxEnqueueRowsSchema.parse(await this.#rpc(
      "enqueue outbox",
      "enqueue_bridge_outbox_message",
      {
        p_conversation_key: opaqueKey(conversationKey, "conversationKey"),
        p_logical_key: safeLogicalKey,
        p_payload_hash: createHash("sha256").update(safeBody, "utf8").digest("hex"),
        p_body: safeBody,
        p_available_at: timestampSchema.parse(availableAt),
      },
    ));
    const row = rows[0]!;
    return { messageId: row.message_id, disposition: row.disposition };
  }

  async claimOutbox(workerId: string, limit = 10, leaseSeconds = 60): Promise<OutboxClaim[]> {
    const rows = outboxClaimRowsSchema.parse(await this.#rpc(
      "claim outbox",
      "claim_outbox_messages",
      {
        p_worker_id: boundedString(workerId, 1, 120, "workerId"),
        p_limit: integerInRange(limit, 1, 100, "limit"),
        p_lease_seconds: integerInRange(leaseSeconds, 10, 3600, "leaseSeconds"),
      },
    ));
    return rows.map((row) => ({
      messageId: row.message_id,
      principalId: row.principal_id,
      conversationId: row.conversation_id,
      logicalKey: row.logical_key,
      payloadHash: row.payload_hash,
      body: row.body,
      claimToken: row.claim_token,
      attemptCount: row.attempt_count,
    }));
  }

  async markOutboxSent(
    messageId: string,
    claimToken: string,
    providerMessageId: string,
  ): Promise<boolean> {
    return z.boolean().parse(await this.#rpc("mark outbox sent", "mark_outbox_sent", {
      p_message_id: uuidSchema.parse(messageId),
      p_claim_token: uuidSchema.parse(claimToken),
      p_provider_message_id: boundedString(providerMessageId, 1, 256, "providerMessageId"),
    }));
  }

  async markOutboxUncertain(
    messageId: string,
    claimToken: string,
    errorCode: string,
  ): Promise<boolean> {
    return z.boolean().parse(await this.#rpc(
      "mark outbox uncertain",
      "mark_outbox_uncertain",
      {
        p_message_id: uuidSchema.parse(messageId),
        p_claim_token: uuidSchema.parse(claimToken),
        p_error_code: boundedString(errorCode, 1, 80, "errorCode"),
      },
    ));
  }

  async #rpc(
    operation: string,
    functionName: string,
    parameters: Record<string, unknown>,
  ): Promise<unknown> {
    let result: RpcResult;
    try {
      result = await this.#client.rpc(functionName, parameters);
    } catch {
      throw new SupabaseBridgeStoreError(operation, "transport");
    }
    if (result.error) throw new SupabaseBridgeStoreError(operation, result.error.code);
    return result.data;
  }
}

export function createSupabaseBridgeStore(
  url: string,
  serviceRoleKey: string,
  options: SupabaseBridgeStoreOptions = {},
): SupabaseBridgeStore {
  const normalizedUrl = url.trim();
  const normalizedKey = serviceRoleKey.trim();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    throw new Error("SUPABASE_URL must be an absolute HTTP(S) URL.");
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("SUPABASE_URL must be an absolute HTTP(S) URL.");
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("SUPABASE_URL must not contain credentials.");
  }
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsedUrl.hostname);
  if (parsedUrl.protocol !== "https:" && !isLoopback) {
    throw new Error("SUPABASE_URL must use HTTPS outside local development.");
  }
  if (!normalizedKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");

  const client = createClient(normalizedUrl, normalizedKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const rpcClient: SupabaseRpcClient = {
    async rpc(functionName, parameters) {
      const { data, error } = await client.rpc(functionName, parameters);
      return { data, error };
    },
  };
  return new SupabaseBridgeStore(rpcClient, options);
}

function opaqueKey(value: string, field: string): string {
  const parsed = opaqueKeySchema.safeParse(value);
  if (!parsed.success) throw new TypeError(`${field} must be an opaque HMAC-SHA256 key.`);
  return parsed.data;
}

function boundedString(value: string, minimum: number, maximum: number, field: string): string {
  if (value.length < minimum || value.length > maximum) {
    throw new TypeError(`${field} must be between ${minimum} and ${maximum} characters.`);
  }
  return value;
}

function integerInRange(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}
