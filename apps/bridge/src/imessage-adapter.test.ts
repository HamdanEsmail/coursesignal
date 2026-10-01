import { describe, expect, it, vi } from "vitest";
import { filterHumanIMessage, routeIMessageEvent } from "./imessage-adapter.js";
import { silentLogger } from "./logger.js";
import type { BridgeLogger } from "./types.js";

const NOW = new Date("2026-10-01T18:00:00.000Z");

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

function space() {
  return {
    id: "provider-chat-id",
    send: vi.fn(async () => undefined),
    startTyping: vi.fn(async () => undefined),
    stopTyping: vi.fn(async () => undefined),
  };
}

describe("filterHumanIMessage", () => {
  it("accepts only normal inbound human text", () => {
    const result = filterHumanIMessage(humanMessage());
    expect(result.accepted).toBe(true);
    if (result.accepted) expect(result.message.text).toBe("echo iPhone proof");
  });

  it.each([
    ["explicit outbound", { direction: "outbound" }],
    ["self text with unreliable inbound direction", { direction: "inbound", isSent: true, isFromMe: true }],
    ["read receipt", { content: { type: "read", target: {} } }],
    ["reaction", { content: { type: "reaction" }, reactionRecord: { selected: true } }],
    ["system event", { isSystemMessage: true }],
    ["service event", { isServiceMessage: true }],
    ["group change", { itemType: "participantChange" }],
    ["attachment", { content: { type: "attachment", id: "file" } }],
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
  ])("does not call bridge.handle for %s", async (_label, message) => {
    const handle = vi.fn(async () => "accepted" as const);
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
    const handle = vi.fn(async (_envelope, port) => {
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
      handle: vi.fn(async () => "accepted" as const),
    });
    expect(debug).toHaveBeenCalledOnce();
    const serialized = JSON.stringify(debug.mock.calls[0]);
    expect(serialized).not.toContain("private-guid");
    expect(serialized).not.toContain("private body");
    expect(serialized).not.toContain("+971");
    expect(serialized).toContain("contentKind");
  });
});
