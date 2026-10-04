import { describe, expect, it } from "vitest";
import { isLodgeEventQueryKey } from "./calendar.js";
import {
  LODGE_PAGES_ORIGIN,
  LODGE_SLIP_LABEL,
  buildSlipUrl,
  namedSlipLink,
  parseSlipQuery,
  type SlipInput,
} from "./slips.js";

const TIME_ZONE = "Asia/Dubai";

const FLU: SlipInput = {
  title: "Flu clinic",
  start: "2026-10-08T08:00:00.000Z",
  end: "2026-10-08T09:00:00.000Z",
  location: "Health Center",
  url: "https://health.example.edu/flu",
};

const FORM: SlipInput = {
  title: "Housing application",
  url: "https://housing.example.edu/apply",
};

const IDENTITY = {
  conversationKey: "cafef00dconversation-key-9f3a",
  phone: "+971500000000",
  personName: "Amina Al-Hashimi",
  senderKey: "sender-amina-hash",
};

function dirtySlip(input: SlipInput): SlipInput {
  return {
    ...input,
    conversationKey: IDENTITY.conversationKey,
    phone: IDENTITY.phone,
    name: IDENTITY.personName,
    senderKey: IDENTITY.senderKey,
    source: IDENTITY.phone,
  } as SlipInput;
}

function assertNoIdentity(value: string): void {
  expect(value).not.toContain(IDENTITY.conversationKey);
  expect(value).not.toContain(IDENTITY.phone);
  expect(value).not.toContain("971500000000");
  expect(value).not.toContain(IDENTITY.personName);
  expect(value).not.toMatch(/Amina/i);
  expect(value).not.toMatch(/Al-Hashimi/i);
  expect(value).not.toContain(IDENTITY.senderKey);
  expect(value).not.toMatch(/conversationKey/i);
  expect(value).not.toMatch(/(?:^|[?&])phone=/i);
}

describe("Lodge slip URL", () => {
  it("builds /slip with query-string event fields only", () => {
    const url = buildSlipUrl(FLU);
    expect(url.startsWith(`${LODGE_PAGES_ORIGIN}/slip?`)).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("title")).toBe("Flu clinic");
    expect(params.get("start")).toBe("2026-10-08T08:00:00.000Z");
    expect(params.get("end")).toBe("2026-10-08T09:00:00.000Z");
    expect(params.get("location")).toBe("Health Center");
    expect(params.get("url")).toBe("https://health.example.edu/flu");
    expect([...params.keys()].every(isLodgeEventQueryKey)).toBe(true);
    expect(parseSlipQuery(params)).toEqual({
      title: "Flu clinic",
      start: "2026-10-08T08:00:00.000Z",
      end: "2026-10-08T09:00:00.000Z",
      location: "Health Center",
      url: "https://health.example.edu/flu",
    });
  });

  it("allows a slip with title and source url and no times", () => {
    const url = buildSlipUrl(FORM);
    const params = new URL(url).searchParams;
    expect([...params.keys()].sort()).toEqual(["title", "url"]);
    expect(params.get("title")).toBe("Housing application");
    expect(params.has("start")).toBe(false);
    expect(params.has("end")).toBe(false);
  });

  it("names the Lodge slip instead of dumping the query string", () => {
    expect(LODGE_SLIP_LABEL).toBe("Lodge slip");
    const timed = namedSlipLink(FLU, { timeZone: TIME_ZONE });
    expect(timed.label).toBe("Lodge slip · Flu clinic · Thu 12:00");
    expect(timed.label).not.toContain("?");
    expect(timed.label).not.toContain("slip?");
    expect(timed.label).not.toContain("start=");
    expect(timed.label).not.toMatch(/CourseSignal/i);
    expect(timed.url).toContain("/slip?");

    const form = namedSlipLink(FORM);
    expect(form.label).toBe("Lodge slip · Housing application");
    expect(form.label).not.toContain("https://");
  });
});

describe("privacy", () => {
  it("never puts conversation keys, phones, or names of people on slip URLs or labels", () => {
    const dirty = dirtySlip(FLU);
    const url = buildSlipUrl(dirty);
    const link = namedSlipLink(dirty, { timeZone: TIME_ZONE });
    assertNoIdentity(url);
    assertNoIdentity(link.label);
    assertNoIdentity(link.url);
    const keys = [...new URL(url).searchParams.keys()];
    expect(keys.sort()).toEqual(["end", "location", "start", "title", "url"]);
    expect(keys).not.toContain("conversationKey");
    expect(keys).not.toContain("phone");
    expect(keys).not.toContain("name");
    expect(keys).not.toContain("senderKey");
    expect(keys).not.toContain("source");
    expect(link.label).not.toMatch(/CourseSignal/i);
  });
});
