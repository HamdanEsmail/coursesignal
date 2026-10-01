import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BridgeStore, ConversationMemory } from "./types.js";

type PersistedState = {
  version: 1;
  claimedInbound: Record<string, InboundClaim | string>;
  conversations: Record<string, ConversationMemory>;
};

type InboundClaim = {
  receivedAt: string;
  leasedAt: string;
  leaseToken?: string;
  state: "processing" | "complete";
};

const CLAIM_LEASE_MS = 5 * 60 * 1_000;

const EMPTY_STATE: PersistedState = {
  version: 1,
  claimedInbound: {},
  conversations: {},
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryBridgeStore implements BridgeStore {
  readonly #claimedInbound = new Map<string, InboundClaim>();
  readonly #conversations = new Map<string, ConversationMemory>();

  async claimInbound(eventKey: string, receivedAt: string): Promise<string | undefined> {
    const current = this.#claimedInbound.get(eventKey);
    if (current?.state === "complete") return undefined;
    if (current && Date.now() - Date.parse(current.leasedAt) < CLAIM_LEASE_MS) return undefined;
    const leaseToken = randomUUID();
    this.#claimedInbound.set(eventKey, {
      receivedAt,
      leasedAt: new Date().toISOString(),
      leaseToken,
      state: "processing",
    });
    return leaseToken;
  }

  async completeInbound(eventKey: string, claimToken: string): Promise<void> {
    const current = this.#claimedInbound.get(eventKey);
    if (current?.state === "processing" && current.leaseToken === claimToken) {
      this.#claimedInbound.set(eventKey, {
        ...current,
        leaseToken: undefined,
        state: "complete",
      });
    }
  }

  async releaseInbound(eventKey: string, claimToken: string): Promise<void> {
    const current = this.#claimedInbound.get(eventKey);
    if (current?.state === "processing" && current.leaseToken === claimToken) {
      this.#claimedInbound.delete(eventKey);
    }
  }

  async getConversation(conversationKey: string): Promise<ConversationMemory | undefined> {
    const value = this.#conversations.get(conversationKey);
    return value ? clone(value) : undefined;
  }

  async putConversation(conversationKey: string, memory: ConversationMemory): Promise<void> {
    this.#conversations.set(conversationKey, clone(memory));
  }

  async deleteConversation(conversationKey: string): Promise<void> {
    this.#conversations.delete(conversationKey);
  }
}

/**
 * Small single-process durable store for the Photon bridge. It is deliberately
 * hidden behind BridgeStore so a hosted deployment can swap in a transactional
 * database without changing message policy.
 */
export class JsonFileBridgeStore implements BridgeStore {
  readonly #path: string;
  readonly #dedupRetentionMs: number;
  #state: PersistedState | undefined;
  #exclusive: Promise<void> = Promise.resolve();

  constructor(path: string, options: { dedupRetentionMs?: number } = {}) {
    this.#path = path;
    this.#dedupRetentionMs = options.dedupRetentionMs ?? 7 * 24 * 60 * 60 * 1_000;
  }

  async claimInbound(eventKey: string, receivedAt: string): Promise<string | undefined> {
    let claimToken: string | undefined;
    await this.#mutate((state) => {
      this.#pruneClaims(state);
      const existing = normalizeClaim(state.claimedInbound[eventKey]);
      if (existing?.state === "complete") return;
      if (existing && Date.now() - Date.parse(existing.leasedAt) < CLAIM_LEASE_MS) return;
      claimToken = randomUUID();
      state.claimedInbound[eventKey] = {
        receivedAt,
        leasedAt: new Date().toISOString(),
        leaseToken: claimToken,
        state: "processing",
      };
    });
    return claimToken;
  }

  async completeInbound(eventKey: string, claimToken: string): Promise<void> {
    await this.#mutate((state) => {
      const current = normalizeClaim(state.claimedInbound[eventKey]);
      if (current?.state === "processing" && current.leaseToken === claimToken) {
        state.claimedInbound[eventKey] = {
          ...current,
          leaseToken: undefined,
          state: "complete",
        };
      }
    });
  }

  async releaseInbound(eventKey: string, claimToken: string): Promise<void> {
    await this.#mutate((state) => {
      const current = normalizeClaim(state.claimedInbound[eventKey]);
      if (current?.state === "processing" && current.leaseToken === claimToken) {
        delete state.claimedInbound[eventKey];
      }
    });
  }

  async getConversation(conversationKey: string): Promise<ConversationMemory | undefined> {
    await this.#ready();
    const value = this.#state?.conversations[conversationKey];
    return value ? clone(value) : undefined;
  }

  async putConversation(conversationKey: string, memory: ConversationMemory): Promise<void> {
    await this.#mutate((state) => {
      state.conversations[conversationKey] = clone(memory);
    });
  }

  async deleteConversation(conversationKey: string): Promise<void> {
    await this.#mutate((state) => {
      delete state.conversations[conversationKey];
    });
  }

  async close(): Promise<void> {
    await this.#exclusive;
  }

  async #ready(): Promise<void> {
    if (this.#state) return;
    try {
      const parsed = JSON.parse(await readFile(this.#path, "utf8")) as Partial<PersistedState>;
      this.#state = {
        version: 1,
        claimedInbound: parsed.claimedInbound ?? {},
        conversations: parsed.conversations ?? {},
      };
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code !== "ENOENT") throw error;
      this.#state = clone(EMPTY_STATE);
    }
  }

  async #mutate(mutation: (state: PersistedState) => void): Promise<void> {
    const action = this.#exclusive.then(async () => {
      await this.#ready();
      const next = clone(this.#state ?? EMPTY_STATE);
      mutation(next);
      await this.#write(next);
      this.#state = next;
    });
    this.#exclusive = action.catch(() => undefined);
    await action;
  }

  async #write(state: PersistedState): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const temporary = `${this.#path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.#path);
    await chmod(this.#path, 0o600).catch(() => undefined);
  }

  #pruneClaims(state: PersistedState): void {
    const cutoff = Date.now() - this.#dedupRetentionMs;
    for (const [key, claim] of Object.entries(state.claimedInbound)) {
      if (Date.parse(normalizeClaim(claim)?.receivedAt ?? "") < cutoff) delete state.claimedInbound[key];
    }
  }
}

function normalizeClaim(value: InboundClaim | string | undefined): InboundClaim | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    return { receivedAt: value, leasedAt: value, state: "complete" };
  }
  return value;
}
