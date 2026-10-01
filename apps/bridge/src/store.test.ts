import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryBridgeStore, JsonFileBridgeStore } from "./store.js";
import type { ConversationMemory } from "./types.js";

const temporaryDirectories: string[] = [];
const NOW = "2026-10-01T18:00:00.000Z";

afterEach(async () => {
  for (const path of temporaryDirectories.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

function memory(): ConversationMemory {
  return {
    consentedAt: NOW,
    courses: ["STAT 210"],
    activeCourse: "STAT 210",
    watches: [],
    updatedAt: NOW,
  };
}

describe("InMemoryBridgeStore", () => {
  it("atomically rejects a duplicate inbound event", async () => {
    const store = new InMemoryBridgeStore();
    const results = await Promise.all([
      store.claimInbound("event-1", NOW),
      store.claimInbound("event-1", NOW),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("can release failed work but permanently suppresses completed work", async () => {
    const store = new InMemoryBridgeStore();
    const first = await store.claimInbound("event-release", NOW);
    expect(first).toBeTypeOf("string");
    await store.releaseInbound("event-release", first!);
    const second = await store.claimInbound("event-release", NOW);
    expect(second).toBeTypeOf("string");
    await store.completeInbound("event-release", second!);
    expect(await store.claimInbound("event-release", NOW)).toBeUndefined();
  });

  it("does not let a stale lease complete or release current work", async () => {
    const store = new InMemoryBridgeStore();
    const current = await store.claimInbound("event-current", NOW);
    await store.completeInbound("event-current", "00000000-0000-4000-8000-000000000000");
    await store.releaseInbound("event-current", "00000000-0000-4000-8000-000000000000");
    expect(await store.claimInbound("event-current", NOW)).toBeUndefined();
    await store.completeInbound("event-current", current!);
    expect(await store.claimInbound("event-current", NOW)).toBeUndefined();
  });

  it("returns defensive copies of conversation state", async () => {
    const store = new InMemoryBridgeStore();
    await store.putConversation("chat", memory());
    const first = await store.getConversation("chat");
    first?.courses.push("BANA 200");
    expect((await store.getConversation("chat"))?.courses).toEqual(["STAT 210"]);
  });
});

describe("JsonFileBridgeStore", () => {
  it("preserves dedup claims and memory across a restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "coursesignal-store-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.json");
    const first = new JsonFileBridgeStore(path, { dedupRetentionMs: Number.MAX_SAFE_INTEGER });
    const claim = await first.claimInbound("event-1", NOW);
    expect(claim).toBeTypeOf("string");
    await first.completeInbound("event-1", claim!);
    await first.putConversation("chat", memory());
    await first.close();

    const second = new JsonFileBridgeStore(path, { dedupRetentionMs: Number.MAX_SAFE_INTEGER });
    expect(await second.claimInbound("event-1", NOW)).toBeUndefined();
    expect((await second.getConversation("chat"))?.activeCourse).toBe("STAT 210");
  });

  it("writes only the opaque keys supplied to it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "coursesignal-store-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.json");
    const store = new JsonFileBridgeStore(path);
    await store.claimInbound("opaque-event", NOW);
    await store.putConversation("opaque-chat", memory());
    const saved = await readFile(path, "utf8");
    expect(saved).toContain("opaque-event");
    expect(saved).toContain("opaque-chat");
    expect(saved).not.toMatch(/\+971|@icloud\.com/i);
  });
});
