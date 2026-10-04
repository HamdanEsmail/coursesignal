import { describe, expect, it, vi } from "vitest";
import { filterHumanIMessage, routeIMessageEvent } from "./imessage-adapter.js";
import { silentLogger } from "./logger.js";
import type { BridgeLogger, ConversationPort, InboundEnvelope } from "./types.js";

const NOW = new Date("2026-10-01T18:00:00.000Z");
const SLIP_URL = "https://coursesignal-bzb.pages.dev/slip?title=Due";

function humanMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    platform: "imessage",
    direction: "inbound",
    id: "provider-message-id",
    sender: { id: "+971500000000" },
    timestamp: NOW,
    isSent: false,
    isFromMe: false,
    isServiceMessage: false,
    isSystemMessage: false,
    isAutoReply: false,
    isCorrupt: false,
    isSpam: false,
    itemType: "normal",
    content: { type: "text", text: "echo iPhone proof" },
    ...overrides,
  };
}

function loveTapback() {
  return humanMessage({
    content: { type: "reaction", emoji: "❤️" },
    reactionRecord: {
      selected: true,
      reaction: { kind: "love" },
      targetGuid: "target-message",
    },
  });
}

function photoMessage(read?: () => Promise<unknown>) {
  return humanMessage({
    content: {
      type: "attachment",
      id: "photo-guid",
      name: "poster.jpg",
      mimeType: "image/jpeg",
      ...(read ? { read } : {}),
    },
  });
}

function space(extra: {
  send?: ReturnType<typeof vi.fn>;
  getMessage?: ReturnType<typeof vi.fn>;
  edit?: ReturnType<typeof vi.fn>;
  unsend?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    id: "provider-chat-id",
    send: extra.send ?? vi.fn(async (_content?: unknown) => undefined),
    startTyping: vi.fn(async () => undefined),
    stopTyping: vi.fn(async () => undefined),
    getMessage: extra.getMessage,
    edit: extra.edit,
    unsend: extra.unsend,
  };
}

function acceptingHandle() {
  return vi.fn(async (_envelope: InboundEnvelope, _port: ConversationPort) => "accepted" as const);
}

describe("filterHumanIMessage", () => {
  it("accepts only normal inbound human text", () => {
    const result = filterHumanIMessage(humanMessage());
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.message.text).toBe("echo iPhone proof");
      expect(result.message.content).toEqual({ type: "text", text: "echo iPhone proof" });
    }
  });

  it.each([
    ["love", "❤️", "love"],
    ["like", "👍", "like"],
    ["dislike", "👎", "dislike"],
    ["question", "❓", "question"],
  ] as const)("accepts %s tapback as %s", (_label, emoji, kind) => {
    const result = filterHumanIMessage(humanMessage({
      content: { type: "reaction", emoji },
      reactionRecord: { selected: true, reaction: { kind }, targetGuid: "target" },
    }));
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.message.content).toEqual({ type: "unsupported", kind });
      expect(result.message.text).toBe(emoji);
    }
  });

  it("accepts a love tapback that only carries content.emoji", () => {
    const result = filterHumanIMessage(humanMessage({
      content: { type: "reaction", emoji: "❤️" },
    }));
    expect(result.accepted).toBe(true);
    if (result.accepted) expect(result.message.content).toEqual({ type: "unsupported", kind: "love" });
  });

  it("accepts a poster photo without reading bytes", () => {
    const read = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const result = filterHumanIMessage(photoMessage(read));
    expect(result.accepted).toBe(true);
    expect(read).not.toHaveBeenCalled();
    if (result.accepted) {
      expect(result.message.content).toMatchObject({ type: "unsupported", kind: "image", mimeType: "image/jpeg" });
    }
  });

  it("accepts an HEIC photo from Apple UTI plus filename", () => {
    const result = filterHumanIMessage(humanMessage({
      content: { type: "attachment", id: "heic", name: "IMG_1001.HEIC", mimeType: "public.heic" },
    }));
    expect(result.accepted).toBe(true);
    if (result.accepted) expect(result.message.content).toMatchObject({ type: "unsupported", kind: "image" });
  });

  it("accepts a photo bundled in a group album", () => {
    const result = filterHumanIMessage(humanMessage({
      content: {
        type: "group",
        items: [{
          content: { type: "attachment", id: "photo", name: "poster.png", mimeType: "image/png" },
        }],
      },
    }));
    expect(result.accepted).toBe(true);
    if (result.accepted) expect(result.message.content).toMatchObject({ kind: "image", mimeType: "image/png" });
  });

  it("accepts a selected poll vote", () => {
    const result = filterHumanIMessage(humanMessage({
      content: {
        type: "poll_option",
        selected: true,
        title: "Friday",
        option: { title: "Friday" },
        poll: { type: "poll", title: "When?", options: [{ title: "Friday" }, { title: "Monday" }] },
      },
    }));
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.message.content).toMatchObject({ type: "unsupported", kind: "poll_vote", option: "Friday" });
      expect(result.message.text).toBe("Friday");
    }
  });

  it("accepts reply-wrapped human text", () => {
    const result = filterHumanIMessage(humanMessage({
      content: { type: "reply", content: { type: "text", text: "save this" }, target: {} },
    }));
    expect(result.accepted).toBe(true);
    if (result.accepted) expect(result.message.content).toEqual({ type: "text", text: "save this" });
  });

  it.each([
    ["explicit outbound", { direction: "outbound" }],
    ["self text with unreliable inbound direction", { direction: "inbound", isSent: true, isFromMe: true }],
    ["read receipt", { content: { type: "read", target: {} } }],
    ["laugh tapback", { content: { type: "reaction", emoji: "😂" }, reactionRecord: { selected: true, reaction: { kind: "laugh" } } }],
    ["cleared love tapback", { content: { type: "reaction", emoji: "❤️" }, reactionRecord: { selected: false, reaction: { kind: "love" } } }],
    ["bare reaction without a Lodge kind", { content: { type: "reaction" }, reactionRecord: { selected: true } }],
    ["system event", { isSystemMessage: true }],
    ["service event", { isServiceMessage: true }],
    ["group change", { itemType: "participantChange" }],
    ["non-image attachment", { content: { type: "attachment", id: "file", mimeType: "application/pdf" } }],
    ["sticker photo", { content: { type: "attachment", id: "sticker", mimeType: "image/png", isSticker: true } }],
    ["deselected poll vote", { content: { type: "poll_option", selected: false, title: "Friday" } }],
    ["missing sender", { sender: undefined }],
  ])("rejects %s", (_label, overrides) => {
    expect(filterHumanIMessage(humanMessage(overrides)).accepted).toBe(false);
  });
});

describe("routeIMessageEvent", () => {
  it.each([
    ["outbound text", humanMessage({ direction: "inbound", isSent: true })],
    ["delivery/read receipt", humanMessage({ content: { type: "read", target: {} } })],
    ["typing/control event", humanMessage({ content: { type: "typing" } })],
    ["laugh tapback", humanMessage({ content: { type: "reaction", emoji: "😂" }, reactionRecord: { selected: true, reaction: { kind: "laugh" } } })],
  ])("does not call bridge.handle for %s", async (_label, message) => {
    const handle = acceptingHandle();
    const routed = await routeIMessageEvent({
      space: space(),
      message,
      stateSecret: "secret",
      logger: silentLogger,
      handle,
    });
    expect(routed).toBe(false);
    expect(handle).not.toHaveBeenCalled();
  });

  it("routes accepted text with opaque keys and a working reply port", async () => {
    const providerSpace = space();
    const handle = vi.fn(async (_envelope: InboundEnvelope, port: ConversationPort) => {
      await port.send("reply");
      return "accepted" as const;
    });
    expect(await routeIMessageEvent({
      space: providerSpace,
      message: humanMessage(),
      stateSecret: "secret",
      logger: silentLogger,
      handle,
    })).toBe(true);

    expect(handle).toHaveBeenCalledOnce();
    const envelope = handle.mock.calls[0]?.[0];
    expect(envelope?.content).toEqual({ type: "text", text: "echo iPhone proof" });
    expect(envelope?.eventKey).not.toContain("provider-message-id");
    expect(envelope?.conversationKey).not.toContain("provider-chat-id");
    expect(envelope?.senderKey).not.toContain("+971");
    expect(providerSpace.send).toHaveBeenCalledWith("reply");
  });

  it("routes Lodge tapbacks, photos, and poll votes without downloading the image", async () => {
    const read = vi.fn(async () => new Uint8Array([9]));
    const handle = acceptingHandle();

    expect(await routeIMessageEvent({
      space: space(),
      message: loveTapback(),
      stateSecret: "secret",
      logger: silentLogger,
      handle,
    })).toBe(true);
    expect(handle.mock.calls[0]?.[0]?.content).toEqual({ type: "unsupported", kind: "love" });

    expect(await routeIMessageEvent({
      space: space(),
      message: photoMessage(read),
      stateSecret: "secret",
      logger: silentLogger,
      handle,
    })).toBe(true);
    expect(handle.mock.calls[1]?.[0]?.content).toMatchObject({ type: "unsupported", kind: "image" });
    expect(typeof (handle.mock.calls[1]?.[0]?.content as { read?: unknown }).read).toBe("function");
    expect(read).not.toHaveBeenCalled();

    expect(await routeIMessageEvent({
      space: space(),
      message: humanMessage({
        content: { type: "poll_option", selected: true, title: "This week" },
      }),
      stateSecret: "secret",
      logger: silentLogger,
      handle,
    })).toBe(true);
    expect(handle.mock.calls[2]?.[0]?.content).toMatchObject({
      type: "unsupported",
      kind: "poll_vote",
      option: "This week",
    });
  });

  it("wires Spectrum space/message craft methods and no-ops when they are missing", async () => {
    const target = {
      id: "target-mid",
      react: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
      edit: vi.fn(async () => undefined),
      unsend: vi.fn(async () => undefined),
    };
    const providerSpace = space({
      getMessage: vi.fn(async (id: unknown) => id === "target-mid" ? target : undefined),
      edit: vi.fn(async () => undefined),
      unsend: vi.fn(async () => undefined),
      send: vi.fn(async (content: unknown) => {
        if (typeof content === "object" && content !== null) return { id: "app-1" };
        return undefined;
      }),
    });

    const handle = vi.fn(async (_envelope: InboundEnvelope, port: ConversationPort) => {
      await port.react?.("target-mid", "love");
      await port.reply?.("noted", "target-mid");
      await port.edit?.("target-mid", "edited");
      await port.unsend?.("target-mid");
      const first = await port.sendApp?.({ url: SLIP_URL, title: "Looking it up…" });
      const second = await port.sendApp?.({ url: SLIP_URL, title: "Reading your page…" });
      await port.sendPoll?.({ question: "When works?", options: ["Friday", "Monday"] });
      await port.sendRichLink?.({ url: SLIP_URL, title: "Slip" });
      await port.send("plain text still works");
      expect(first).toEqual({ messageId: "app-1" });
      expect(second).toEqual({ messageId: "app-1" });
      return "accepted" as const;
    });

    expect(await routeIMessageEvent({
      space: providerSpace,
      message: humanMessage(),
      stateSecret: "secret",
      logger: silentLogger,
      handle,
    })).toBe(true);

    expect(target.react).toHaveBeenCalledWith("❤️");
    expect(target.reply).toHaveBeenCalledWith("noted");
    expect(providerSpace.unsend?.mock.calls[0]?.[0]).toBe(target);
    expect(providerSpace.send).toHaveBeenCalledWith("plain text still works");
    expect(providerSpace.send.mock.calls.filter((call) => call[0] === "plain text still works")).toHaveLength(1);
    expect(providerSpace.edit?.mock.calls.length ?? 0).toBeGreaterThanOrEqual(2);

    const textOnly = space();
    const missing = vi.fn(async (_envelope: InboundEnvelope, port: ConversationPort) => {
      await port.react?.("missing", "like");
      await port.reply?.("x", "missing");
      await port.edit?.("missing", "x");
      await port.unsend?.("missing");
      expect(await port.sendApp?.({ url: SLIP_URL, title: "Due" })).toBeUndefined();
      await port.sendPoll?.({ question: "When?", options: ["A"] });
      await port.send("text-only");
      return "accepted" as const;
    });
    expect(await routeIMessageEvent({
      space: textOnly,
      message: humanMessage(),
      stateSecret: "secret",
      logger: silentLogger,
      handle: missing,
    })).toBe(true);
    expect(textOnly.send).toHaveBeenCalledWith("text-only");
    expect(textOnly.send.mock.calls.some((call) => typeof call[0] === "object")).toBe(true);
  });

  it("logs ignored event metadata only at debug level", async () => {
    const debug = vi.fn();
    const logger: BridgeLogger = { ...silentLogger, debug };
    await routeIMessageEvent({
      space: space(),
      message: humanMessage({
        id: "private-guid",
        sender: { id: "+971500000000" },
        content: { type: "read", text: "private body" },
      }),
      stateSecret: "secret",
      logger,
      handle: acceptingHandle(),
    });
    expect(debug).toHaveBeenCalledOnce();
    const serialized = JSON.stringify(debug.mock.calls[0]);
    expect(serialized).not.toContain("private-guid");
    expect(serialized).not.toContain("private body");
    expect(serialized).not.toContain("+971");
    expect(serialized).toContain("contentKind");
  });
});
