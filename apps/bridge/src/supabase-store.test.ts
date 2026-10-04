import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredBridgeStoreBackend, createConfiguredBridge } from "./bootstrap.js";
import {
  createSupabaseBridgeStore,
  SupabaseBridgeStore,
  SupabaseBridgeStoreError,
  type SupabaseRpcClient,
} from "./supabase-store.js";
import {
  LODGE_CONSENT_VERSION,
  LODGE_NOTEBOOK_CAP,
  type ConversationMemory,
  type NotebookNote,
} from "./types.js";

const NOW = "2026-10-01T18:00:00.000Z";
const EVENT_KEY = "a".repeat(64);
const CONVERSATION_KEY = "b".repeat(64);
const CLAIM_TOKEN = "10000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "20000000-0000-4000-8000-000000000002";
const PRINCIPAL_ID = "30000000-0000-4000-8000-000000000003";
const CONVERSATION_ID = "40000000-0000-4000-8000-000000000004";

afterEach(() => {
  vi.unstubAllEnvs();
});

type RpcCall = {
  functionName: string;
  parameters?: Record<string, unknown>;
};

const SPACE_CIPHERTEXT = "ab".repeat(32);
const LEAKY_CIPHERTEXT = "cipher-should-not-leak-9f3a";

function memory(): ConversationMemory {
  return {
    consentedAt: NOW,
    consentVersion: 3,
    courses: ["STAT 210"],
    activeCourse: "STAT 210",
    watches: [],
    updatedAt: NOW,
  };
}

function notebookNotes(count: number): NotebookNote[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    kind: "freeform" as const,
    text: `Note ${index + 1}`,
    createdAt: NOW,
  }));
}

function lodgeMemory(): ConversationMemory {
  return {
    consentedAt: NOW,
    consentVersion: LODGE_CONSENT_VERSION,
    courses: [],
    watches: [],
    updatedAt: NOW,
    school: "NYU Abu Dhabi",
    timezone: "Asia/Dubai",
    quietHours: { start: "22:00", end: "08:00", enabled: true },
    savedLinks: [{
      id: "20000000-0000-4000-8000-000000000002",
      kind: "course",
      url: "https://example.edu/econ",
      title: "Econ",
      createdAt: NOW,
      contentHash: "c".repeat(64),
      lastFetchedAt: NOW,
      watchEnabled: true,
    }],
    notebook: [{
      id: "10000000-0000-4000-8000-000000000001",
      kind: "opportunity",
      text: "Internship in Dubai",
      createdAt: NOW,
      url: "https://example.com/jobs/1",
      company: "Example",
      listingTitle: "Intern",
      applied: false,
    }],
    pendingReminders: [{
      id: "30000000-0000-4000-8000-000000000003",
      text: "Flu clinic",
      fireAt: "2026-10-04T08:05:00.000Z",
      createdAt: NOW,
      status: "scheduled",
      ignoreQuietHours: true,
      localFireLabel: "Tomorrow, 12:05",
    }],
    lastTrace: {
      at: NOW,
      checkedLive: true,
      steps: [{ tool: "fetch", outcome: "ok", url: "https://example.edu/econ", durationMs: 120 }],
    },
    encryptedSpaceHandle: {
      version: 1,
      ciphertext: SPACE_CIPHERTEXT,
      wrappedAt: NOW,
    },
    pendingRememberPage: {
      url: "https://example.edu/events",
      kind: "events",
      title: "Events",
      excerpt: "Open night",
      offeredAt: NOW,
    },
    rolesCity: "Dubai",
    rolesOptIn: true,
    checkInStep: "done",
    checkInCompletedAt: NOW,
    checkInSkippedAt: NOW,
    lastRolesWatchAt: NOW,
  };
}

function recordingClient(): {
  client: SupabaseRpcClient;
  calls: RpcCall[];
  stored: { memory?: unknown };
} {
  const calls: RpcCall[] = [];
  const stored: { memory?: unknown } = {};
  return {
    calls,
    stored,
    client: {
      async rpc(functionName, parameters) {
        calls.push({ functionName, parameters });
        if (functionName === "put_bridge_runtime_state") {
          stored.memory = structuredClone(parameters?.p_memory);
          return { data: null, error: null };
        }
        if (functionName === "get_bridge_runtime_state") {
          return { data: stored.memory ?? null, error: null };
        }
        return { data: null, error: null };
      },
    },
  };
}

function fakeClient(
  handle: (call: RpcCall) => { data: unknown; error: { code?: string; message?: string } | null },
): { client: SupabaseRpcClient; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  return {
    calls,
    client: {
      async rpc(functionName, parameters) {
        const call = { functionName, parameters };
        calls.push(call);
        return handle(call);
      },
    },
  };
}

describe("SupabaseBridgeStore", () => {
  it("uses token-protected RPCs for inbound claims", async () => {
    const fake = fakeClient(({ functionName }) => ({
      data: functionName === "claim_bridge_inbound" ? CLAIM_TOKEN : true,
      error: null,
    }));
    const store = new SupabaseBridgeStore(fake.client);

    expect(await store.claimInbound(EVENT_KEY, NOW)).toBe(CLAIM_TOKEN);
    await store.completeInbound(EVENT_KEY, CLAIM_TOKEN);
    expect(fake.calls).toEqual([
      {
        functionName: "claim_bridge_inbound",
        parameters: {
          p_event_key: EVENT_KEY,
          p_received_at: NOW,
          p_lease_seconds: 300,
          p_retention_seconds: 604800,
        },
      },
      {
        functionName: "complete_bridge_inbound",
        parameters: {
          p_event_key: EVENT_KEY,
          p_lease_token: CLAIM_TOKEN,
        },
      },
    ]);
  });

  it("treats a null claim as a duplicate and fails closed on a lost lease", async () => {
    const fake = fakeClient(({ functionName }) => ({
      data: functionName === "claim_bridge_inbound" ? null : false,
      error: null,
    }));
    const store = new SupabaseBridgeStore(fake.client);

    expect(await store.claimInbound(EVENT_KEY, NOW)).toBeUndefined();
    await expect(store.completeInbound(EVENT_KEY, CLAIM_TOKEN)).rejects.toMatchObject({
      name: "SupabaseBridgeStoreError",
      code: "lease_lost",
    });
  });

  it("still loads a version-2 memory row from before follow-up topics", async () => {
    const legacy = { ...memory(), consentVersion: 2 as const };
    const fake = fakeClient(() => ({ data: legacy, error: null }));
    const store = new SupabaseBridgeStore(fake.client);
    await expect(store.getConversation(CONVERSATION_KEY)).resolves.toMatchObject({
      consentVersion: 2,
      activeCourse: "STAT 210",
    });
  });

  it("round-trips validated conversation memory without sharing references", async () => {
    const saved = memory();
    const fake = fakeClient(({ functionName }) => ({
      data: functionName === "get_bridge_runtime_state" ? saved : null,
      error: null,
    }));
    const store = new SupabaseBridgeStore(fake.client);

    const loaded = await store.getConversation(CONVERSATION_KEY);
    loaded?.courses.push("BANA 200");
    expect(saved.courses).toEqual(["STAT 210"]);

    const next = memory();
    await store.putConversation(CONVERSATION_KEY, next);
    next.courses.push("ECON 110");
    expect(fake.calls.at(-1)?.parameters?.p_memory).toMatchObject({
      courses: ["STAT 210"],
    });
  });

  it("persists consent 2 and 3 payloads that omit Lodge keys", async () => {
    for (const consentVersion of [2, 3] as const) {
      const recorded = recordingClient();
      const store = new SupabaseBridgeStore(recorded.client);
      const legacy = { ...memory(), consentVersion };
      await store.putConversation(CONVERSATION_KEY, legacy);
      expect(recorded.stored.memory).toEqual({
        consentedAt: NOW,
        consentVersion,
        courses: ["STAT 210"],
        activeCourse: "STAT 210",
        watches: [],
        updatedAt: NOW,
      });
      expect(recorded.stored.memory).not.toHaveProperty("school");
      expect(recorded.stored.memory).not.toHaveProperty("notebook");
      expect(recorded.stored.memory).not.toHaveProperty("encryptedSpaceHandle");
      expect(recorded.stored.memory).not.toHaveProperty("checkInStep");
      await expect(store.getConversation(CONVERSATION_KEY)).resolves.toEqual(recorded.stored.memory);
    }
  });

  it("round-trips Lodge additive fields including consent 4", async () => {
    const recorded = recordingClient();
    const store = new SupabaseBridgeStore(recorded.client);
    const lodge = lodgeMemory();
    await store.putConversation(CONVERSATION_KEY, lodge);
    lodge.notebook?.push({
      id: "10000000-0000-4000-8000-000000000099",
      kind: "freeform",
      text: "mutated after put",
      createdAt: NOW,
    });

    const persisted = recorded.stored.memory as ConversationMemory;
    expect(persisted).toMatchObject({
      consentVersion: 4,
      school: "NYU Abu Dhabi",
      timezone: "Asia/Dubai",
      quietHours: { start: "22:00", end: "08:00", enabled: true },
      rolesCity: "Dubai",
      rolesOptIn: true,
      checkInStep: "done",
      checkInCompletedAt: NOW,
      checkInSkippedAt: NOW,
      lastRolesWatchAt: NOW,
    });
    expect(persisted.savedLinks).toHaveLength(1);
    expect(persisted.notebook).toHaveLength(1);
    expect(persisted.pendingReminders?.[0]?.status).toBe("scheduled");
    expect(persisted.lastTrace?.steps[0]?.tool).toBe("fetch");
    expect(persisted.pendingRememberPage?.kind).toBe("events");
    expect(persisted.encryptedSpaceHandle).toEqual({
      version: 1,
      ciphertext: SPACE_CIPHERTEXT,
      wrappedAt: NOW,
    });

    const loaded = await store.getConversation(CONVERSATION_KEY);
    expect(loaded).toEqual(persisted);
    loaded?.notebook?.push({
      id: "10000000-0000-4000-8000-000000000098",
      kind: "freeform",
      text: "mutated after get",
      createdAt: NOW,
    });
    expect((await store.getConversation(CONVERSATION_KEY))?.notebook).toHaveLength(1);
  });

  it("accepts a full notebook of 30 notes and rejects the 31st", async () => {
    const recorded = recordingClient();
    const store = new SupabaseBridgeStore(recorded.client);
    const atCap = { ...lodgeMemory(), notebook: notebookNotes(LODGE_NOTEBOOK_CAP) };
    await store.putConversation(CONVERSATION_KEY, atCap);
    expect((recorded.stored.memory as ConversationMemory).notebook).toHaveLength(30);

    await expect(store.putConversation(
      CONVERSATION_KEY,
      { ...lodgeMemory(), notebook: notebookNotes(LODGE_NOTEBOOK_CAP + 1) },
    )).rejects.toThrow(/failed validation/i);
    expect(recorded.calls.filter((call) => call.functionName === "put_bridge_runtime_state")).toHaveLength(1);
  });

  it("never puts an encrypted space handle into validation errors", async () => {
    const fake = fakeClient(() => ({ data: null, error: null }));
    const store = new SupabaseBridgeStore(fake.client);
    const invalid = {
      ...lodgeMemory(),
      encryptedSpaceHandle: {
        version: 1 as const,
        ciphertext: LEAKY_CIPHERTEXT,
        wrappedAt: NOW,
      },
    };

    const error = await store.putConversation(CONVERSATION_KEY, invalid).catch((caught) => caught);
    expect(error).toBeInstanceOf(TypeError);
    expect(String(error)).toMatch(/failed validation/i);
    expect(String(error)).not.toContain(LEAKY_CIPHERTEXT);
    expect(String(error)).not.toContain(SPACE_CIPHERTEXT);
    expect(JSON.stringify(error)).not.toContain(LEAKY_CIPHERTEXT);
    expect(fake.calls).toEqual([]);
  });

  it("rejects plaintext identifiers before making a request", async () => {
    const fake = fakeClient(() => ({ data: null, error: null }));
    const store = new SupabaseBridgeStore(fake.client);

    await expect(store.getConversation("+971501234567")).rejects.toThrow(/opaque HMAC-SHA256/i);
    await expect(store.claimInbound("provider-message-id", NOW)).rejects.toThrow(/opaque HMAC-SHA256/i);
    expect(fake.calls).toEqual([]);
  });

  it("delegates to the normalized outbox and hashes the body locally", async () => {
    const fake = fakeClient(({ functionName }) => {
      if (functionName === "enqueue_bridge_outbox_message") {
        return { data: [{ message_id: MESSAGE_ID, disposition: "queued" }], error: null };
      }
      if (functionName === "claim_outbox_messages") {
        return {
          data: [{
            message_id: MESSAGE_ID,
            principal_id: PRINCIPAL_ID,
            conversation_id: CONVERSATION_ID,
            logical_key: "event:reply",
            payload_hash: "c".repeat(64),
            body: "Verified reply",
            claim_token: CLAIM_TOKEN,
            attempt_count: 1,
          }],
          error: null,
        };
      }
      return { data: true, error: null };
    });
    const store = new SupabaseBridgeStore(fake.client);

    await expect(store.enqueueOutbox(
      CONVERSATION_KEY,
      "event:reply",
      "Verified reply",
      NOW,
    )).resolves.toEqual({ messageId: MESSAGE_ID, disposition: "queued" });
    expect(fake.calls[0]?.parameters?.p_payload_hash).toBe(
      createHash("sha256").update("Verified reply").digest("hex"),
    );

    await expect(store.claimOutbox("worker-a", 1, 60)).resolves.toEqual([{
      messageId: MESSAGE_ID,
      principalId: PRINCIPAL_ID,
      conversationId: CONVERSATION_ID,
      logicalKey: "event:reply",
      payloadHash: "c".repeat(64),
      body: "Verified reply",
      claimToken: CLAIM_TOKEN,
      attemptCount: 1,
    }]);
    await expect(store.markOutboxSent(MESSAGE_ID, CLAIM_TOKEN, "provider-1")).resolves.toBe(true);
    await expect(store.markOutboxUncertain(MESSAGE_ID, CLAIM_TOKEN, "PROVIDER_TIMEOUT")).resolves.toBe(true);
  });

  it("does not expose server error messages or request values", async () => {
    const fake = fakeClient(() => ({
      data: null,
      error: { code: "42501", message: "secret +971501234567" },
    }));
    const store = new SupabaseBridgeStore(fake.client);

    const error = await store.getConversation(CONVERSATION_KEY).catch((caught) => caught);
    expect(error).toBeInstanceOf(SupabaseBridgeStoreError);
    expect(String(error)).toContain("42501");
    expect(String(error)).not.toContain("secret");
    expect(String(error)).not.toContain("+971");
    expect(String(error)).not.toContain(CONVERSATION_KEY);
  });

  it("refuses to send a service-role key over non-local plaintext HTTP", () => {
    expect(() => createSupabaseBridgeStore(
      "http://supabase.example.test",
      "test-service-role-key",
    )).toThrow(/must use HTTPS/i);
    expect(() => createSupabaseBridgeStore(
      "https://embedded:credential@supabase.example.test",
      "test-service-role-key",
    )).toThrow(/must not contain credentials/i);
  });
});

describe("configuredBridgeStoreBackend", () => {
  it("keeps JSON as the default and requires an explicit Supabase opt-in", () => {
    vi.stubEnv("COURSESIGNAL_STORE", "");
    expect(configuredBridgeStoreBackend()).toBe("json");
    vi.stubEnv("COURSESIGNAL_STORE", "supabase");
    expect(configuredBridgeStoreBackend()).toBe("supabase");
    vi.stubEnv("COURSESIGNAL_STORE", "automatic");
    expect(() => configuredBridgeStoreBackend()).toThrow(/json or supabase/i);
  });

  it("fails startup closed when Supabase was requested without credentials", () => {
    vi.stubEnv("COURSESIGNAL_STORE", "supabase");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => createConfiguredBridge({ stateSecret: "test-state-secret" })).toThrow(
      /SUPABASE_URL is not configured/i,
    );
  });
});
