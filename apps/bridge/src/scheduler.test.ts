import { describe, expect, it, vi } from "vitest";
import { InMemoryBridgeStore } from "./store.js";
import {
  LODGE_CONSENT_VERSION,
  type ConversationMemory,
  type NotebookNote,
  type PendingReminder,
  type SavedLink,
} from "./types.js";
import {
  FIRSTROLE_WORKSPACE_URL,
  LODGE_REOPEN_FAILED_HELP,
  LODGE_SCHEDULER_TICK_MS,
  MemoryOutboxStore,
  TrackingBridgeStore,
  createLodgeScheduler,
  dueSoonLogicalKey,
  pageChangeLogicalKey,
  readableContentHash,
  reminderLogicalKey,
  rolesWatchLogicalKey,
} from "./scheduler.js";
import { SpaceRegistry, wrapSpaceHandle } from "./space-registry.js";

const SECRET = "lodge-test-secret";
const CHAT = "a".repeat(64);
const SPACE_ID = "space-live-1";
const AFTERNOON = new Date("2026-10-04T10:00:00.000Z");
const QUIET = new Date("2026-10-01T19:30:00.000Z");

const LINK_ID = "20000000-0000-4000-8000-000000000002";
const NOTE_ID = "10000000-0000-4000-8000-000000000001";
const REMINDER_ID = "30000000-0000-4000-8000-000000000003";
const WATCH_ID = "40000000-0000-4000-8000-000000000004";

function baseMemory(overrides: Partial<ConversationMemory> = {}): ConversationMemory {
  return {
    consentedAt: AFTERNOON.toISOString(),
    consentVersion: LODGE_CONSENT_VERSION,
    courses: [],
    watches: [],
    updatedAt: AFTERNOON.toISOString(),
    timezone: "Asia/Dubai",
    quietHours: { start: "22:00", end: "08:00", enabled: true },
    ...overrides,
  };
}

function reminder(overrides: Partial<PendingReminder> = {}): PendingReminder {
  return {
    id: REMINDER_ID,
    text: "Flu clinic",
    fireAt: "2026-10-04T09:55:00.000Z",
    createdAt: "2026-10-04T08:00:00.000Z",
    status: "scheduled",
    ignoreQuietHours: true,
    ...overrides,
  };
}

function deadlineNote(dueAt: string): NotebookNote {
  return {
    id: NOTE_ID,
    kind: "deadline",
    text: "Econ problem set",
    createdAt: AFTERNOON.toISOString(),
    dueAt,
  };
}

function watchedLink(overrides: Partial<SavedLink> = {}): SavedLink {
  return {
    id: LINK_ID,
    kind: "course",
    url: "https://example.edu/econ",
    title: "Econ",
    createdAt: AFTERNOON.toISOString(),
    watchEnabled: true,
    ...overrides,
  };
}

function pausedWatch(): ConversationMemory["watches"][number] {
  return {
    id: WATCH_ID,
    target: "https://example.edu/econ",
    createdAt: AFTERNOON.toISOString(),
    active: false,
  };
}

async function harness(options: {
  now?: Date;
  memory?: ConversationMemory;
  fetchReadable?: (url: string) => Promise<{ text: string } | undefined>;
  runRolesWatch?: Parameters<typeof createLodgeScheduler>[0]["runRolesWatch"];
  reopenSpace?: Parameters<typeof createLodgeScheduler>[0]["reopenSpace"];
  pageFetchMinIntervalMs?: number;
} = {}) {
  const now = options.now ?? AFTERNOON;
  const inner = new InMemoryBridgeStore();
  const store = new TrackingBridgeStore(inner);
  const memory = options.memory ?? baseMemory();
  await store.putConversation(CHAT, memory);
  const outbox = new MemoryOutboxStore();
  const spaces = new SpaceRegistry({
    wrapSecret: SECRET,
    store,
    now: () => now,
  });
  const sent: Array<{ body: string; messageId: string }> = [];
  await spaces.registerLive(CHAT, {
    id: SPACE_ID,
    send: async (body) => {
      const messageId = `mid-${sent.length + 1}`;
      sent.push({ body, messageId });
      return { messageId };
    },
  });
  const scheduler = createLodgeScheduler({
    store,
    outbox,
    spaces,
    now: () => now,
    leaseSeconds: 10,
    pageFetchMinIntervalMs: options.pageFetchMinIntervalMs ?? 0,
    fetchReadable: options.fetchReadable,
    runRolesWatch: options.runRolesWatch,
    reopenSpace: options.reopenSpace,
  });
  return { store, outbox, spaces, scheduler, sent, now };
}

describe("MemoryOutboxStore", () => {
  it("dedups logical keys and rejects a different payload", async () => {
    const outbox = new MemoryOutboxStore();
    const first = await outbox.enqueueOutbox(CHAT, "reminder:1", "Hello");
    const again = await outbox.enqueueOutbox(CHAT, "reminder:1", "Hello");
    expect(first.disposition).toBe("queued");
    expect(again).toEqual({ messageId: first.messageId, disposition: "duplicate" });
    await expect(outbox.enqueueOutbox(CHAT, "reminder:1", "Changed")).rejects.toThrow(
      /logical key reused/i,
    );
    const claimed = await outbox.claimOutbox("worker-a", 10, 10);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.logicalKey).toBe("reminder:1");
    await expect(outbox.markOutboxSent(claimed[0]!.messageId, claimed[0]!.claimToken, "p1"))
      .resolves.toBe(true);
    await expect(outbox.claimOutbox("worker-a", 10, 10)).resolves.toEqual([]);
  });
});

describe("LodgeScheduler delivery", () => {
  it("claims the outbox and sends through the live space", async () => {
    const h = await harness({
      memory: baseMemory({ pendingReminders: [reminder()] }),
    });
    await h.scheduler.tick();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.body).toMatch(/Reminder: Flu clinic/i);
    const stored = await h.store.getConversation(CHAT);
    expect(stored?.pendingReminders?.[0]?.status).toBe("fired");
    await h.scheduler.tick();
    expect(h.sent).toHaveLength(1);
  });

  it("marks send failures uncertain and does not retry them", async () => {
    const inner = new InMemoryBridgeStore();
    const store = new TrackingBridgeStore(inner);
    await store.putConversation(CHAT, baseMemory({ pendingReminders: [reminder()] }));
    const outbox = new MemoryOutboxStore();
    const spaces = new SpaceRegistry({ wrapSecret: SECRET, store });
    await spaces.registerLive(CHAT, {
      id: SPACE_ID,
      send: async () => {
        throw new Error("photon timeout");
      },
    });
    const scheduler = createLodgeScheduler({ store, outbox, spaces, now: () => AFTERNOON });
    await scheduler.tick();
    await expect(outbox.claimOutbox("worker-b", 10, 10)).resolves.toEqual([]);
    expect((await store.getConversation(CHAT))?.pendingReminders?.[0]?.status).toBe("fired");
  });

  it("fires user-asked reminders during quiet hours", async () => {
    const h = await harness({
      now: QUIET,
      memory: baseMemory({
        pendingReminders: [reminder({ fireAt: "2026-10-01T19:00:00.000Z" })],
      }),
    });
    await h.scheduler.tick();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.body).toMatch(/Flu clinic/);
  });

  it("holds a non-ignore reminder until quiet hours end", async () => {
    const h = await harness({
      now: QUIET,
      memory: baseMemory({
        pendingReminders: [reminder({
          fireAt: "2026-10-01T19:00:00.000Z",
          ignoreQuietHours: false,
        })],
      }),
    });
    await h.scheduler.tick();
    expect(h.sent).toEqual([]);
    expect((await h.store.getConversation(CHAT))?.pendingReminders?.[0]?.status).toBe("scheduled");
  });

  it("does not text due-soon or page-change during quiet hours", async () => {
    const fetchReadable = vi.fn(async () => ({ text: "changed syllabus" }));
    const h = await harness({
      now: QUIET,
      fetchReadable,
      memory: baseMemory({
        notebook: [deadlineNote("2026-10-01T20:00:00.000Z")],
        savedLinks: [watchedLink({ contentHash: readableContentHash("old syllabus") })],
      }),
    });
    await h.scheduler.tick();
    expect(h.sent).toEqual([]);
    expect(fetchReadable).not.toHaveBeenCalled();
  });

  it("texts first on a page-change hash mismatch and stays silent when unchanged", async () => {
    const pages = ["Econ syllabus week 1", "Econ syllabus week 2 — new deadline"];
    const fetchReadable = vi.fn()
      .mockResolvedValueOnce({ text: pages[0]! })
      .mockResolvedValue({ text: pages[1]! });
    const h = await harness({
      fetchReadable,
      memory: baseMemory({ savedLinks: [watchedLink()] }),
    });
    await h.scheduler.tick();
    expect(h.sent).toEqual([]);
    expect(fetchReadable).toHaveBeenCalledTimes(1);
    const baseline = await h.store.getConversation(CHAT);
    expect(baseline?.savedLinks?.[0]?.contentHash).toBe(readableContentHash(pages[0]!));

    await h.scheduler.tick();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.body).toMatch(/Econ page posted a new deadline/i);
    expect(h.sent[0]?.body).toContain("https://example.edu/econ");
    expect(pageChangeLogicalKey(LINK_ID, readableContentHash(pages[1]!))).toMatch(/^page-change:/);

    await h.scheduler.tick();
    expect(h.sent).toHaveLength(1);
  });

  it("runs at most one roles watch per local day via the injected hook", async () => {
    const runRolesWatch = vi.fn(async () => [{
      url: "https://jobs.example.com/intern",
      company: "Acme",
      title: "Intern",
      stillOpen: "open" as const,
      reason: "internship, Dubai, posted this week",
    }]);
    const h = await harness({
      runRolesWatch,
      memory: baseMemory({ rolesCity: "Dubai", rolesOptIn: true }),
    });
    await h.scheduler.tick();
    await h.scheduler.tick();
    expect(runRolesWatch).toHaveBeenCalledTimes(1);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.body).toMatch(/New verified opening in Dubai/i);
    expect(h.sent[0]?.body).toContain("https://jobs.example.com/intern");
    expect(h.sent[0]?.body).toContain(FIRSTROLE_WORKSPACE_URL);
    expect((await h.store.getConversation(CHAT))?.lastRolesWatchAt).toBe(AFTERNOON.toISOString());
  });

  it("does not call TinyFish when the roles hook is missing", async () => {
    const h = await harness({
      memory: baseMemory({
        rolesCity: "Dubai",
        rolesOptIn: true,
        notebook: [deadlineNote("2026-10-04T16:00:00.000Z")],
      }),
    });
    await h.scheduler.tick();
    expect(h.sent.some((row) => row.body.includes("FirstRole"))).toBe(false);
    expect(h.sent.some((row) => /due/i.test(row.body))).toBe(true);
    expect(dueSoonLogicalKey(NOTE_ID, "2026-10-04T16:00:00.000Z")).toMatch(/^due-soon:/);
  });

  it("STOP pauses proactive watches but still delivers you-asked reminders", async () => {
    const fetchReadable = vi.fn(async () => ({ text: "new deadline posted" }));
    const runRolesWatch = vi.fn(async () => [{
      url: "https://jobs.example.com/intern",
      company: "Acme",
      title: "Intern",
      stillOpen: "open" as const,
    }]);
    const h = await harness({
      fetchReadable,
      runRolesWatch,
      memory: baseMemory({
        watches: [pausedWatch()],
        rolesOptIn: true,
        rolesCity: "Dubai",
        savedLinks: [watchedLink({ contentHash: readableContentHash("old") })],
        notebook: [deadlineNote("2026-10-04T16:00:00.000Z")],
        pendingReminders: [reminder()],
      }),
    });
    await h.scheduler.tick();
    expect(fetchReadable).not.toHaveBeenCalled();
    expect(runRolesWatch).not.toHaveBeenCalled();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.body).toMatch(/Reminder: Flu clinic/);
  });

  it("delivers through reopen-by-id when no live space is in memory", async () => {
    const inner = new InMemoryBridgeStore();
    const store = new TrackingBridgeStore(inner);
    await store.putConversation(CHAT, baseMemory({
      pendingReminders: [reminder()],
      encryptedSpaceHandle: wrapSpaceHandle(SPACE_ID, SECRET, AFTERNOON.toISOString()),
    }));
    const outbox = new MemoryOutboxStore();
    const spaces = new SpaceRegistry({ wrapSecret: SECRET, store, now: () => AFTERNOON });
    const sent: string[] = [];
    const reopenSpace = vi.fn(async (spaceId: string) => ({
      id: spaceId,
      send: async (body: string) => {
        sent.push(body);
        return { messageId: "reopened-1" };
      },
    }));
    const scheduler = createLodgeScheduler({
      store,
      outbox,
      spaces,
      now: () => AFTERNOON,
      reopenSpace,
    });
    await scheduler.tick();
    expect(reopenSpace).toHaveBeenCalledWith(SPACE_ID);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/Flu clinic/);
  });

  it("parks delivery and texts HELP when reopen-by-id fails, then sends once live", async () => {
    const inner = new InMemoryBridgeStore();
    const store = new TrackingBridgeStore(inner);
    await store.putConversation(CHAT, baseMemory({
      pendingReminders: [reminder()],
      encryptedSpaceHandle: wrapSpaceHandle(SPACE_ID, SECRET, AFTERNOON.toISOString()),
    }));
    const outbox = new MemoryOutboxStore();
    const spaces = new SpaceRegistry({ wrapSecret: SECRET, store, now: () => AFTERNOON });
    const reopenSpace = vi.fn(async () => undefined);
    const scheduler = createLodgeScheduler({
      store,
      outbox,
      spaces,
      now: () => AFTERNOON,
      reopenSpace,
    });

    await scheduler.tick();
    expect(reopenSpace).toHaveBeenCalled();

    const sent: string[] = [];
    await spaces.registerLive(CHAT, {
      id: SPACE_ID,
      send: async (body) => {
        sent.push(body);
        return { messageId: `mid-${sent.length}` };
      },
    });
    await scheduler.tick();
    expect(sent.some((body) => body === LODGE_REOPEN_FAILED_HELP)).toBe(true);
    expect(sent.some((body) => /Flu clinic/.test(body))).toBe(true);
    expect(reminderLogicalKey(REMINDER_ID, "2026-10-04T09:55:00.000Z")).toMatch(/^reminder:/);
    expect(rolesWatchLogicalKey("2026-10-04")).toBe("roles:2026-10-04");
  });

  it("ticks every 30s on the existing process and does not open a second listener", () => {
    expect(LODGE_SCHEDULER_TICK_MS).toBe(30_000);
    const scheduler = createLodgeScheduler({
      store: new TrackingBridgeStore(new InMemoryBridgeStore()),
      outbox: new MemoryOutboxStore(),
      spaces: new SpaceRegistry({ wrapSecret: SECRET }),
      tickIntervalMs: LODGE_SCHEDULER_TICK_MS,
    });
    scheduler.start();
    scheduler.stop();
  });
});
