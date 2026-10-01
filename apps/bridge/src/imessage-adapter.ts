import { opaqueIdentifier } from "./identifiers.js";
import type {
  BridgeLogger,
  ConversationPort,
  HandleDisposition,
  InboundEnvelope,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;

export type IMessageEventDiagnostic = {
  platform: string;
  direction: string;
  contentKind: string;
  senderPresent: boolean;
  isFromMe: boolean;
  isSent: boolean;
  isService: boolean;
  isSystem: boolean;
  isAutoReply: boolean;
  isCorrupt: boolean;
  isSpam: boolean;
  hasReaction: boolean;
  itemType: string;
};

export type AcceptedIMessage = {
  id: string;
  text: string;
  senderId: string;
  timestamp: Date;
};

export type IMessageFilterResult =
  | { accepted: true; message: AcceptedIMessage; diagnostic: IMessageEventDiagnostic }
  | { accepted: false; reason: string; diagnostic: IMessageEventDiagnostic };

export function filterHumanIMessage(value: unknown): IMessageFilterResult {
  const message = record(value);
  const content = record(message.content);
  const sender = record(message.sender);
  const diagnostic: IMessageEventDiagnostic = {
    platform: stringValue(message.platform),
    direction: stringValue(message.direction),
    contentKind: stringValue(content.type),
    senderPresent: Boolean(stringValue(sender.id)),
    isFromMe: message.isFromMe === true,
    isSent: message.isSent === true,
    isService: message.isServiceMessage === true,
    isSystem: message.isSystemMessage === true,
    isAutoReply: message.isAutoReply === true,
    isCorrupt: message.isCorrupt === true,
    isSpam: message.isSpam === true,
    hasReaction: Boolean(message.reactionRecord),
    itemType: stringValue(message.itemType),
  };

  if (diagnostic.platform !== "imessage") return { accepted: false, reason: "platform", diagnostic };
  if (diagnostic.direction !== "inbound") return { accepted: false, reason: "direction", diagnostic };
  if (diagnostic.isFromMe || diagnostic.isSent) return { accepted: false, reason: "self", diagnostic };
  if (!diagnostic.senderPresent) return { accepted: false, reason: "sender", diagnostic };
  if (
    diagnostic.isService ||
    diagnostic.isSystem ||
    diagnostic.isAutoReply ||
    diagnostic.isCorrupt ||
    diagnostic.isSpam
  ) return { accepted: false, reason: "provider-control", diagnostic };
  if (diagnostic.hasReaction) return { accepted: false, reason: "reaction", diagnostic };
  if (diagnostic.itemType && diagnostic.itemType !== "normal") {
    return { accepted: false, reason: "item-type", diagnostic };
  }
  if (diagnostic.contentKind !== "text") return { accepted: false, reason: "non-text", diagnostic };

  const id = stringValue(message.id);
  const text = stringValue(content.text).trim();
  const senderId = stringValue(sender.id);
  const timestamp = message.timestamp instanceof Date ? message.timestamp : new Date(Number.NaN);
  if (!id || !text || !Number.isFinite(timestamp.getTime())) {
    return { accepted: false, reason: "malformed", diagnostic };
  }
  return { accepted: true, message: { id, text, senderId, timestamp }, diagnostic };
}

export async function routeIMessageEvent(options: {
  space: unknown;
  message: unknown;
  stateSecret: string;
  logger: BridgeLogger;
  handle: (envelope: InboundEnvelope, port: ConversationPort) => Promise<HandleDisposition>;
}): Promise<boolean> {
  const filtered = filterHumanIMessage(options.message);
  if (!filtered.accepted) {
    options.logger.debug("provider.event_ignored", {
      reason: filtered.reason,
      ...filtered.diagnostic,
    });
    return false;
  }

  const space = record(options.space);
  const spaceId = stringValue(space.id);
  const send = functionValue(space.send);
  if (!spaceId || !send) {
    options.logger.warn("provider.space_invalid");
    return false;
  }
  const startTyping = functionValue(space.startTyping);
  const stopTyping = functionValue(space.stopTyping);
  const envelope: InboundEnvelope = {
    eventKey: opaqueIdentifier("event", filtered.message.id, options.stateSecret),
    conversationKey: opaqueIdentifier("conversation", spaceId, options.stateSecret),
    senderKey: opaqueIdentifier("sender", filtered.message.senderId, options.stateSecret),
    receivedAt: filtered.message.timestamp.toISOString(),
    content: { type: "text", text: filtered.message.text },
  };
  const port: ConversationPort = {
    send: async (body) => void await send.call(options.space, body),
    startTyping: startTyping
      ? async () => void await startTyping.call(options.space)
      : undefined,
    stopTyping: stopTyping
      ? async () => void await stopTyping.call(options.space)
      : undefined,
  };
  await options.handle(envelope, port);
  return true;
}

function record(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null ? value as UnknownRecord : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function functionValue(value: unknown): ((...args: unknown[]) => unknown) | undefined {
  return typeof value === "function" ? value as (...args: unknown[]) => unknown : undefined;
}
