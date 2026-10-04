import { describe, expect, it, vi } from "vitest";
import { InMemoryBridgeStore } from "./store.js";
import {
  LODGE_CONSENT_VERSION,
  type ConversationMemory,
} from "./types.js";
import {
  LODGE_REOPEN_FAILED_HELP,
  SpaceRegistry,
  liveSpaceFromUnknown,
  reopenFromSpectrumClient,
  unwrapSpaceHandle,
  wrapSpaceHandle,
} from "./space-registry.js";

const NOW = "2026-10-04T10:00:00.000Z";
const SECRET = "lodge-test-secret";
const SPACE_ID = "space-abc-123";

function memory(): ConversationMemory {
  return {
    consentedAt: NOW,
    consentVersion: LODGE_CONSENT_VERSION,
    courses: [],
    watches: [],
    updatedAt: NOW,
  };
}

describe("wrapSpaceHandle", () => {
  it("round-trips a space id and never puts ciphertext in errors", () => {
    const wrapped = wrapSpaceHandle(SPACE_ID, SECRET, NOW);
    expect(wrapped.version).toBe(1);
    expect(wrapped.ciphertext).toMatch(/^[0-9a-f]+$/);
    expect(wrapped.ciphertext.length).toBeGreaterThanOrEqual(64);
    expect(wrapped.ciphertext).not.toContain(SPACE_ID);
    expect(unwrapSpaceHandle(wrapped, SECRET)).toBe(SPACE_ID);

    const tampered = { ...wrapped, ciphertext: `ff${wrapped.ciphertext.slice(2)}` };
    const error = (() => {
      try {
        unwrapSpaceHandle(tampered, SECRET);
        return undefined;
      } catch (caught) {
        return caught;
      }
    })();
    expect(String(error)).toMatch(/unwrap failed/i);
    expect(String(error)).not.toContain(wrapped.ciphertext);
    expect(String(error)).not.toContain(SPACE_ID);
  });
});

describe("liveSpaceFromUnknown", () => {
  it("adapts a Spectrum-like space send to messageId", async () => {
    const sent: string[] = [];
    const live = liveSpaceFromUnknown({
      id: SPACE_ID,
      send: async (body: string) => {
        sent.push(body);
        return { id: "mid-1" };
      },
    });
    expect(live?.id).toBe(SPACE_ID);
    await expect(live?.send("hello")).resolves.toEqual({ messageId: "mid-1" });
    expect(sent).toEqual(["hello"]);
    expect(liveSpaceFromUnknown({ send: async () => undefined })).toBeUndefined();
  });
});

describe("reopenFromSpectrumClient", () => {
  it("uses getSpace on the existing client and does not invent a listener", async () => {
    const getSpace = vi.fn(async (id: string) => ({
      id,
      send: async () => ({ id: "reopened" }),
    }));
    const reopen = reopenFromSpectrumClient({ getSpace });
    const space = await reopen?.(SPACE_ID);
    expect(getSpace).toHaveBeenCalledTimes(1);
    expect(getSpace).toHaveBeenCalledWith(SPACE_ID);
    expect(space?.id).toBe(SPACE_ID);
    expect(reopenFromSpectrumClient({ messages: [] })).toBeUndefined();
  });
});

describe("SpaceRegistry", () => {
  it("registers a live space and persists an encrypted handle onto existing memory", async () => {
    const store = new InMemoryBridgeStore();
    await store.putConversation("chat", memory());
    const spaces = new SpaceRegistry({ wrapSecret: SECRET, store, now: () => new Date(NOW) });
    await spaces.registerLive("chat", {
      id: SPACE_ID,
      send: async () => ({ messageId: "m1" }),
    });

    expect(spaces.get("chat")?.id).toBe(SPACE_ID);
    const stored = await store.getConversation("chat");
    expect(stored?.encryptedSpaceHandle?.version).toBe(1);
    expect(stored?.encryptedSpaceHandle?.ciphertext).toMatch(/^[0-9a-f]+$/);
    expect(unwrapSpaceHandle(stored!.encryptedSpaceHandle!, SECRET)).toBe(SPACE_ID);
    expect(JSON.stringify(stored)).not.toContain(SPACE_ID);
  });

  it("does not create conversation memory just to store a handle", async () => {
    const store = new InMemoryBridgeStore();
    const spaces = new SpaceRegistry({ wrapSecret: SECRET, store, now: () => new Date(NOW) });
    await spaces.registerLive("unknown", {
      id: SPACE_ID,
      send: async () => undefined,
    });
    expect(await store.getConversation("unknown")).toBeUndefined();
    expect(spaces.get("unknown")?.id).toBe(SPACE_ID);
  });

  it("reopens from the encrypted handle through an injected hook", async () => {
    const store = new InMemoryBridgeStore();
    const handle = wrapSpaceHandle(SPACE_ID, SECRET, NOW);
    await store.putConversation("chat", { ...memory(), encryptedSpaceHandle: handle });
    const spaces = new SpaceRegistry({ wrapSecret: SECRET, store });
    const reopen = vi.fn(async (spaceId: string) => ({
      id: spaceId,
      send: async () => ({ messageId: "re-1" }),
    }));
    const live = await spaces.reopen("chat", await store.getConversation("chat"), reopen);
    expect(reopen).toHaveBeenCalledWith(SPACE_ID);
    expect(live?.id).toBe(SPACE_ID);
    expect(spaces.get("chat")?.id).toBe(SPACE_ID);
  });

  it("returns undefined when reopen-by-id fails", async () => {
    const store = new InMemoryBridgeStore();
    await store.putConversation("chat", {
      ...memory(),
      encryptedSpaceHandle: wrapSpaceHandle(SPACE_ID, SECRET, NOW),
    });
    const spaces = new SpaceRegistry({ wrapSecret: SECRET, store });
    const live = await spaces.reopen(
      "chat",
      await store.getConversation("chat"),
      async () => undefined,
    );
    expect(live).toBeUndefined();
    expect(LODGE_REOPEN_FAILED_HELP).toMatch(/could not reopen/i);
  });
});
