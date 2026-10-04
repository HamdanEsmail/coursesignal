import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { BridgeStore, ConversationMemory, EncryptedSpaceHandle } from "./types.js";

const HANDLE_INFO = "lodge.space-handle.v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MIN_CIPHERTEXT_BYTES = 32;

export const LODGE_REOPEN_FAILED_HELP = [
  "Lodge could not reopen this iMessage chat after a restart, so a scheduled text waited.",
  "You are connected again. HELP lists commands. You-asked reminders still fire; STOP pauses proactive watches.",
].join("\n");

export type LiveSpace = {
  id: string;
  send(body: string): Promise<{ messageId?: string } | void>;
};

export type SpaceReopener = (spaceId: string) => Promise<LiveSpace | undefined>;

function handleKey(secret: string): Buffer {
  return createHash("sha256").update(HANDLE_INFO).update("\0").update(secret).digest();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function encodeSpaceId(id: string): Buffer {
  const utf8 = Buffer.from(id, "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(utf8.length);
  return Buffer.concat([header, utf8]);
}

function decodeSpaceId(plain: Buffer): string {
  if (plain.length < 4) throw new Error("unwrap");
  const length = plain.readUInt32BE(0);
  const utf8 = plain.subarray(4, 4 + length);
  if (utf8.length !== length) throw new Error("unwrap");
  const id = utf8.toString("utf8").trim();
  if (!id) throw new Error("unwrap");
  return id;
}

/** AES-256-GCM wrap of a space id. Ciphertext is hex(iv || body || tag). Never log it. */
export function wrapSpaceHandle(
  spaceId: string,
  secret: string,
  wrappedAt: string,
): EncryptedSpaceHandle {
  const id = spaceId.trim();
  if (!id || !secret) throw new Error("Space handle wrap failed.");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", handleKey(secret), iv);
  const body = Buffer.concat([cipher.update(encodeSpaceId(id)), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, body, tag]);
  if (packed.length < MIN_CIPHERTEXT_BYTES) throw new Error("Space handle wrap failed.");
  return { version: 1, ciphertext: packed.toString("hex"), wrappedAt };
}

export function unwrapSpaceHandle(handle: EncryptedSpaceHandle, secret: string): string {
  try {
    if (handle.version !== 1 || !secret) throw new Error("unwrap");
    if (!/^[0-9a-f]+$/i.test(handle.ciphertext) || handle.ciphertext.length % 2 !== 0) {
      throw new Error("unwrap");
    }
    const packed = Buffer.from(handle.ciphertext, "hex");
    if (packed.length < MIN_CIPHERTEXT_BYTES) throw new Error("unwrap");
    const iv = packed.subarray(0, IV_BYTES);
    const tag = packed.subarray(packed.length - TAG_BYTES);
    const body = packed.subarray(IV_BYTES, packed.length - TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", handleKey(secret), iv);
    decipher.setAuthTag(tag);
    return decodeSpaceId(Buffer.concat([decipher.update(body), decipher.final()]));
  } catch {
    throw new Error("Space handle unwrap failed.");
  }
}

export function liveSpaceFromUnknown(space: unknown): LiveSpace | undefined {
  const record = asRecord(space);
  if (!record) return undefined;
  const id = stringField(record.id);
  const send = record.send;
  if (!id || typeof send !== "function") return undefined;
  return {
    id,
    send: async (body: string) => {
      const result: unknown = await (send as (this: unknown, text: string) => unknown).call(space, body);
      const sent = asRecord(result);
      const messageId = stringField(sent?.id) || stringField(sent?.messageId);
      return messageId ? { messageId } : {};
    },
  };
}

/** Use methods on the already-connected Spectrum client. Never open a second listener. */
export function reopenFromSpectrumClient(client: unknown): SpaceReopener | undefined {
  const record = asRecord(client);
  if (!record) return undefined;
  const methodName = ["getSpace", "openSpace", "spaceById", "reopen"]
    .find((key) => typeof record[key] === "function");
  if (!methodName) return undefined;
  const method = record[methodName] as (this: unknown, spaceId: string) => unknown;
  return async (spaceId: string) => {
    try {
      return liveSpaceFromUnknown(await method.call(client, spaceId));
    } catch {
      return undefined;
    }
  };
}

export class SpaceRegistry {
  readonly #live = new Map<string, LiveSpace>();
  readonly #secret: string;
  readonly #store: BridgeStore | undefined;
  readonly #now: () => Date;
  #onLive: ((conversationKey: string) => void | Promise<void>) | undefined;

  constructor(options: {
    wrapSecret: string;
    store?: BridgeStore;
    now?: () => Date;
  }) {
    this.#secret = options.wrapSecret;
    this.#store = options.store;
    this.#now = options.now ?? (() => new Date());
  }

  setOnLive(handler: ((conversationKey: string) => void | Promise<void>) | undefined): void {
    this.#onLive = handler;
  }

  get(conversationKey: string): LiveSpace | undefined {
    return this.#live.get(conversationKey);
  }

  conversationKeys(): string[] {
    return [...this.#live.keys()];
  }

  forgetLive(conversationKey: string): void {
    this.#live.delete(conversationKey);
  }

  forgetAllLive(): void {
    this.#live.clear();
  }

  async registerLive(conversationKey: string, space: LiveSpace): Promise<void> {
    this.#live.set(conversationKey, space);
    await this.#persistHandle(conversationKey, space.id);
    await this.#onLive?.(conversationKey);
  }

  async reopen(
    conversationKey: string,
    memory: ConversationMemory | undefined,
    reopenSpace?: SpaceReopener,
  ): Promise<LiveSpace | undefined> {
    const live = this.#live.get(conversationKey);
    if (live) return live;
    const handle = memory?.encryptedSpaceHandle;
    if (!handle || !reopenSpace) return undefined;
    let spaceId: string;
    try {
      spaceId = unwrapSpaceHandle(handle, this.#secret);
    } catch {
      return undefined;
    }
    const reopened = await reopenSpace(spaceId);
    if (!reopened) return undefined;
    this.#live.set(conversationKey, reopened);
    return reopened;
  }

  async #persistHandle(conversationKey: string, spaceId: string): Promise<void> {
    if (!this.#store) return;
    const memory = await this.#store.getConversation(conversationKey);
    if (!memory) return;
    const wrappedAt = this.#now().toISOString();
    const existing = memory.encryptedSpaceHandle;
    if (existing) {
      try {
        if (unwrapSpaceHandle(existing, this.#secret) === spaceId) return;
      } catch {
        // Secret rotation or corrupt handle: wrap again onto existing memory.
      }
    }
    await this.#store.putConversation(conversationKey, {
      ...memory,
      encryptedSpaceHandle: wrapSpaceHandle(spaceId, this.#secret, wrappedAt),
      updatedAt: wrappedAt,
    });
  }
}
