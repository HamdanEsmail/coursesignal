import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryBridgeStore, JsonFileBridgeStore } from "./store.js";
import {
  LODGE_CONSENT_VERSION,
  LODGE_NOTEBOOK_CAP,
  type ConversationMemory,
  type NotebookNote,
} from "./types.js";

const temporaryDirectories: string[] = [];
const NOW = "2026-10-01T18:00:00.000Z";
const SPACE_CIPHERTEXT = "ab".repeat(32);

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
      createdAt: NOW,
    }],
    notebook: [{
      id: "10000000-0000-4000-8000-000000000001",
      kind: "opportunity",
      text: "Internship in Dubai",
      createdAt: NOW,
      url: "https://example.com/jobs/1",
      company: "Example",
      applied: false,
    }],
    pendingReminders: [{
      id: "30000000-0000-4000-8000-000000000003",
      text: "Flu clinic",
      fireAt: "2026-10-04T08:05:00.000Z",
      createdAt: NOW,
      status: "scheduled",
      ignoreQuietHours: true,
    }],
    lastTrace: {
      at: NOW,
      checkedLive: true,
      steps: [{ tool: "fetch", outcome: "ok", url: "https://example.edu/econ" }],
    },
    encryptedSpaceHandle: {
      version: 1,
      ciphertext: SPACE_CIPHERTEXT,
      wrappedAt: NOW,
    },
    pendingRememberPage: {
      url: "https://example.edu/events",
      kind: "events",
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

  it("round-trips Lodge fields and keeps consent 2/3 payloads without Lodge keys", async () => {
    const store = new InMemoryBridgeStore();
    await store.putConversation("legacy-2", { ...memory(), consentVersion: 2 });
    await store.putConversation("legacy-3", { ...memory(), consentVersion: 3 });
    await store.putConversation("lodge", lodgeMemory());

    expect(await store.getConversation("legacy-2")).toEqual({
      ...memory(),
      consentVersion: 2,
    });
    expect(await store.getConversation("legacy-3")).toMatchObject({ consentVersion: 3 });
    expect((await store.getConversation("legacy-3"))).not.toHaveProperty("encryptedSpaceHandle");
    expect((await store.getConversation("lodge"))).toMatchObject({
      consentVersion: 4,
      school: "NYU Abu Dhabi",
      rolesCity: "Dubai",
      checkInStep: "done",
      checkInCompletedAt: NOW,
      checkInSkippedAt: NOW,
      encryptedSpaceHandle: { version: 1, ciphertext: SPACE_CIPHERTEXT },
    });
  });

  it("rejects a 31st notebook note without leaking the space handle", async () => {
    const store = new InMemoryBridgeStore();
    await store.putConversation("chat", { ...lodgeMemory(), notebook: notebookNotes(LODGE_NOTEBOOK_CAP) });
    const error = await store.putConversation(
      "chat",
      { ...lodgeMemory(), notebook: notebookNotes(LODGE_NOTEBOOK_CAP + 1) },
    ).catch((caught) => caught);
    expect(String(error)).toMatch(/failed validation/i);
    expect(String(error)).not.toContain(SPACE_CIPHERTEXT);
    expect((await store.getConversation("chat"))?.notebook).toHaveLength(30);
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

  it("round-trips Lodge memory across a restart, including the space handle", async () => {
    const directory = await mkdtemp(join(tmpdir(), "coursesignal-store-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.json");
    const first = new JsonFileBridgeStore(path);
    await first.putConversation("chat", lodgeMemory());
    await first.close();

    const onDisk = await readFile(path, "utf8");
    expect(onDisk).toContain(SPACE_CIPHERTEXT);
    expect(onDisk).toContain("\"consentVersion\":4");
    expect(onDisk).toContain("NYU Abu Dhabi");

    const second = new JsonFileBridgeStore(path);
    const loaded = await second.getConversation("chat");
    expect(loaded).toMatchObject({
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
      encryptedSpaceHandle: {
        version: 1,
        ciphertext: SPACE_CIPHERTEXT,
        wrappedAt: NOW,
      },
    });
    expect(loaded?.notebook).toHaveLength(1);
    expect(loaded?.savedLinks?.[0]?.url).toBe("https://example.edu/econ");
    expect(loaded?.pendingReminders?.[0]?.ignoreQuietHours).toBe(true);
    expect(loaded?.lastTrace?.checkedLive).toBe(true);
    expect(loaded?.pendingRememberPage?.kind).toBe("events");
  });

  it("reloads consent 2 and 3 payloads that never had Lodge keys", async () => {
    const directory = await mkdtemp(join(tmpdir(), "coursesignal-store-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.json");
    const first = new JsonFileBridgeStore(path);
    await first.putConversation("v2", { ...memory(), consentVersion: 2 });
    await first.putConversation("v3", { ...memory(), consentVersion: 3 });
    await first.close();

    const second = new JsonFileBridgeStore(path);
    const v2 = await second.getConversation("v2");
    const v3 = await second.getConversation("v3");
    expect(v2).toEqual({ ...memory(), consentVersion: 2 });
    expect(v3).toEqual({ ...memory(), consentVersion: 3 });
    expect(v2).not.toHaveProperty("school");
    expect(v3).not.toHaveProperty("notebook");
    expect(v2).not.toHaveProperty("encryptedSpaceHandle");
  });

  it("caps the notebook at 30 without putting the space handle in the error", async () => {
    const directory = await mkdtemp(join(tmpdir(), "coursesignal-store-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "state.json");
    const store = new JsonFileBridgeStore(path);
    await store.putConversation("chat", { ...lodgeMemory(), notebook: notebookNotes(LODGE_NOTEBOOK_CAP) });
    const error = await store.putConversation(
      "chat",
      { ...lodgeMemory(), notebook: notebookNotes(LODGE_NOTEBOOK_CAP + 1) },
    ).catch((caught) => caught);
    expect(String(error)).toMatch(/failed validation/i);
    expect(String(error)).not.toContain(SPACE_CIPHERTEXT);
    expect((await store.getConversation("chat"))?.notebook).toHaveLength(30);
  });
});
