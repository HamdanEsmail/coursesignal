import { describe, expect, expectTypeOf, it } from "vitest";
import {
  LODGE_CONSENT_VERSION,
  LODGE_DEFAULT_QUIET_END,
  LODGE_DEFAULT_QUIET_START,
  LODGE_DEFAULT_TIMEZONE,
  LODGE_NOTEBOOK_CAP,
  type ConsentVersion,
  type ConversationMemory,
  type ConversationPort,
  type DeadlineNote,
  type EncryptedSpaceHandle,
  type EventNote,
  type FreeformNote,
  type LodgeAppCard,
  type NotebookNote,
  type OpportunityNote,
  type PendingRememberPage,
  type PendingReminder,
  type ReminderNote,
} from "./types.js";

describe("Lodge conversation memory contracts", () => {
  it("keeps consent 2 and 3 assignable beside Lodge v4", () => {
    expect(LODGE_CONSENT_VERSION).toBe(4);
    expect(LODGE_NOTEBOOK_CAP).toBe(30);
    expect(LODGE_DEFAULT_TIMEZONE).toBe("Asia/Dubai");
    expect(LODGE_DEFAULT_QUIET_START).toBe("22:00");
    expect(LODGE_DEFAULT_QUIET_END).toBe("08:00");
    expectTypeOf<ConsentVersion>().toEqualTypeOf<2 | 3 | 4>();
  });

  it("accepts pre-Lodge memory so the previous handler still typechecks", () => {
    const legacyV2 = {
      consentedAt: "2026-10-01T18:00:00.000Z",
      consentVersion: 2 as const,
      courses: ["STAT 210"],
      activeCourse: "STAT 210",
      watches: [] as ConversationMemory["watches"],
      updatedAt: "2026-10-01T18:00:00.000Z",
    } satisfies ConversationMemory;
    const legacyV3 = {
      ...legacyV2,
      consentVersion: 3 as const,
    } satisfies ConversationMemory;
    expectTypeOf(legacyV2.consentVersion).toEqualTypeOf<2>();
    expectTypeOf(legacyV3.consentVersion).toEqualTypeOf<3>();
  });

  it("types Lodge check-in, notebook, reminders, space handle, and page offer", () => {
    const opportunity = {
      id: "10000000-0000-4000-8000-000000000001",
      kind: "opportunity",
      text: "Internship in Dubai",
      createdAt: "2026-10-04T08:00:00.000Z",
      url: "https://example.com/jobs/1",
      company: "Example",
      applied: false,
    } satisfies OpportunityNote;
    const lodge: ConversationMemory = {
      consentedAt: "2026-10-04T08:00:00.000Z",
      consentVersion: 4,
      courses: [],
      watches: [],
      updatedAt: "2026-10-04T08:00:00.000Z",
      school: "NYU Abu Dhabi",
      timezone: "Asia/Dubai",
      quietHours: { start: "22:00", end: "08:00", enabled: true },
      savedLinks: [{
        id: "20000000-0000-4000-8000-000000000002",
        kind: "course",
        url: "https://example.edu/econ",
        createdAt: "2026-10-04T08:00:00.000Z",
      }],
      notebook: [opportunity],
      pendingReminders: [{
        id: "30000000-0000-4000-8000-000000000003",
        text: "Flu clinic",
        fireAt: "2026-10-04T08:05:00.000Z",
        createdAt: "2026-10-04T08:00:00.000Z",
        status: "scheduled",
        ignoreQuietHours: true,
      } satisfies PendingReminder],
      lastTrace: {
        at: "2026-10-04T08:00:00.000Z",
        checkedLive: true,
        steps: [{ tool: "fetch", outcome: "ok", url: "https://example.edu/econ" }],
      },
      encryptedSpaceHandle: {
        version: 1,
        ciphertext: "ab".repeat(32),
        wrappedAt: "2026-10-04T08:00:00.000Z",
      } satisfies EncryptedSpaceHandle,
      pendingRememberPage: {
        url: "https://example.edu/events",
        kind: "events",
        offeredAt: "2026-10-04T08:00:00.000Z",
      } satisfies PendingRememberPage,
      rolesCity: "Dubai",
      rolesOptIn: true,
      checkInStep: "done",
    };
    expect(lodge.consentVersion).toBe(LODGE_CONSENT_VERSION);
    expect(lodge.notebook).toHaveLength(1);
    expectTypeOf<ConversationMemory["consentVersion"]>().toEqualTypeOf<2 | 3 | 4 | undefined>();
    expectTypeOf<OpportunityNote["applied"]>().toEqualTypeOf<boolean>();
    expectTypeOf<NotebookNote>().toMatchTypeOf<OpportunityNote | DeadlineNote | EventNote | ReminderNote | FreeformNote>();
  });

  it("keeps ConversationPort implementable with send only", () => {
    const textOnly: ConversationPort = {
      send: async () => undefined,
    };
    const lodgeCraft: ConversationPort = {
      send: async () => undefined,
      react: async () => undefined,
      reply: async () => undefined,
      edit: async () => undefined,
      unsend: async () => undefined,
      sendApp: async () => ({ messageId: "mid" }),
      sendPoll: async () => undefined,
      sendRichLink: async () => undefined,
    };
    expectTypeOf(textOnly.send).toBeFunction();
    expectTypeOf<ConversationPort["sendApp"]>().toMatchTypeOf<
      ((card: LodgeAppCard) => Promise<{ messageId?: string } | void>) | undefined
    >();
    expectTypeOf(lodgeCraft.send).toBeFunction();
  });
});
