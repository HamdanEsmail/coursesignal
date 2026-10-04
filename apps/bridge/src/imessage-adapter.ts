import { opaqueIdentifier } from "./identifiers.js";
import type {
  BridgeLogger,
  ConversationPort,
  ConversationReaction,
  HandleDisposition,
  InboundContent,
  InboundEnvelope,
  LodgeAppCard,
  LodgePoll,
  LodgeRichLink,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;
type SpectrumCraft = typeof import("spectrum-ts");

export const LODGE_REACTION_EMOJI: Record<ConversationReaction, string> = {
  love: "❤️",
  like: "👍",
  dislike: "👎",
  question: "❓",
};

const LODGE_REACTION_KINDS = new Set<string>(["love", "like", "dislike", "question"]);
const EMOJI_TO_REACTION: Record<string, ConversationReaction> = {
  "❤️": "love",
  "❤": "love",
  "♥️": "love",
  "👍": "like",
  "👎": "dislike",
  "❓": "question",
};
const CRAFT_FAILED = Symbol("craft-failed");
let spectrumCraft: SpectrumCraft | undefined;

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

/** Envelope extras Wave 3 can read; InboundContent stays text | unsupported. */
export type LodgeImageInbound = {
  type: "unsupported";
  kind: "image";
  mimeType: string;
  read?: () => Promise<unknown>;
};

export type LodgePollVoteInbound = {
  type: "unsupported";
  kind: "poll_vote";
  option: string;
};

export type LodgeReactionInbound = {
  type: "unsupported";
  kind: ConversationReaction;
};

export type AcceptedIMessage = {
  id: string;
  text: string;
  senderId: string;
  timestamp: Date;
  content: InboundContent;
};

export type IMessageFilterResult =
  | { accepted: true; message: AcceptedIMessage; diagnostic: IMessageEventDiagnostic }
  | { accepted: false; reason: string; diagnostic: IMessageEventDiagnostic };

export function filterHumanIMessage(value: unknown): IMessageFilterResult {
  const message = record(value);
  const rawContent = record(message.content);
  const sender = record(message.sender);
  const diagnostic: IMessageEventDiagnostic = {
    platform: stringValue(message.platform),
    direction: stringValue(message.direction),
    contentKind: stringValue(rawContent.type),
    senderPresent: Boolean(stringValue(sender.id)),
    isFromMe: message.isFromMe === true,
    isSent: message.isSent === true,
    isService: message.isServiceMessage === true,
    isSystem: message.isSystemMessage === true,
    isAutoReply: message.isAutoReply === true,
    isCorrupt: message.isCorrupt === true,
    isSpam: message.isSpam === true,
    hasReaction: Boolean(message.reactionRecord) || stringValue(rawContent.type) === "reaction",
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
  if (diagnostic.itemType && diagnostic.itemType !== "normal") {
    return { accepted: false, reason: "item-type", diagnostic };
  }

  const routed = classifyInbound(message, unwrapContent(rawContent));
  if (!routed.accepted) return { accepted: false, reason: routed.reason, diagnostic };

  const id = stringValue(message.id);
  const senderId = stringValue(sender.id);
  const timestamp = message.timestamp instanceof Date ? message.timestamp : new Date(Number.NaN);
  if (!id || !senderId || !Number.isFinite(timestamp.getTime())) {
    return { accepted: false, reason: "malformed", diagnostic };
  }
  if (routed.content.type === "text" && !routed.text) {
    return { accepted: false, reason: "malformed", diagnostic };
  }
  return {
    accepted: true,
    message: { id, text: routed.text, senderId, timestamp, content: routed.content },
    diagnostic,
  };
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
  const envelope: InboundEnvelope = {
    eventKey: opaqueIdentifier("event", filtered.message.id, options.stateSecret),
    conversationKey: opaqueIdentifier("conversation", spaceId, options.stateSecret),
    senderKey: opaqueIdentifier("sender", filtered.message.senderId, options.stateSecret),
    receivedAt: filtered.message.timestamp.toISOString(),
    content: filtered.message.content,
  };
  await options.handle(envelope, createConversationPort(options.space, send));
  return true;
}

function createConversationPort(
  space: unknown,
  send: (...args: unknown[]) => unknown,
): ConversationPort {
  const spaceRecord = record(space);
  const startTyping = functionValue(spaceRecord.startTyping);
  const stopTyping = functionValue(spaceRecord.stopTyping);
  const editOnSpace = functionValue(spaceRecord.edit);
  const unsendOnSpace = functionValue(spaceRecord.unsend);
  const getMessage = functionValue(spaceRecord.getMessage);
  let lastAppMessage: unknown;

  async function resolveMessage(id: string): Promise<unknown> {
    if (!id || !getMessage) return undefined;
    const resolved = await invoke(getMessage, space, id);
    return resolved === CRAFT_FAILED ? undefined : resolved;
  }

  async function sendCraft(content: unknown): Promise<unknown> {
    return await invoke(send, space, content);
  }

  return {
    send: async (body) => void await send.call(space, body),
    startTyping: startTyping ? async () => void await startTyping.call(space) : undefined,
    stopTyping: stopTyping ? async () => void await stopTyping.call(space) : undefined,
    react: async (targetMessageId, reactionKind) => {
      const emoji = LODGE_REACTION_EMOJI[reactionKind];
      if (!emoji) return;
      const target = await resolveMessage(targetMessageId);
      if (!target) return;
      const reactOnMessage = functionValue(record(target).react);
      if (reactOnMessage) {
        await invoke(reactOnMessage, target, emoji);
        return;
      }
      const spectrum = await loadSpectrum();
      if (!spectrum) return;
      await sendCraft(spectrum.reaction(emoji, target as never));
    },
    reply: async (body, replyToMessageId) => {
      const target = await resolveMessage(replyToMessageId);
      if (!target) return;
      const replyOnMessage = functionValue(record(target).reply);
      if (replyOnMessage) {
        await invoke(replyOnMessage, target, body);
        return;
      }
      const spectrum = await loadSpectrum();
      if (!spectrum) return;
      await sendCraft(spectrum.reply(body, target as never));
    },
    edit: async (messageId, body) => {
      const target = await resolveMessage(messageId);
      if (!target) return;
      if (editOnSpace) {
        await invoke(editOnSpace, space, target, body);
        return;
      }
      const editOnMessage = functionValue(record(target).edit);
      if (editOnMessage) await invoke(editOnMessage, target, body);
    },
    unsend: async (messageId) => {
      const target = await resolveMessage(messageId);
      if (!target) return;
      if (unsendOnSpace) {
        await invoke(unsendOnSpace, space, target);
        return;
      }
      const unsendOnMessage = functionValue(record(target).unsend);
      if (unsendOnMessage) await invoke(unsendOnMessage, target);
    },
    sendApp: async (card: LodgeAppCard) => {
      const builder = await lodgeAppBuilder(card);
      if (!builder) return;
      if (lastAppMessage && editOnSpace) {
        const edited = await invoke(editOnSpace, space, lastAppMessage, builder);
        if (edited !== CRAFT_FAILED) {
          const messageId = messageIdOf(lastAppMessage);
          return messageId ? { messageId } : {};
        }
      }
      const sent = await sendCraft(builder);
      if (sent === CRAFT_FAILED || sent === undefined) return;
      lastAppMessage = sent;
      const messageId = messageIdOf(sent);
      return messageId ? { messageId } : {};
    },
    sendPoll: async (poll: LodgePoll) => {
      const question = poll.question.trim();
      const options = poll.options.map((option) => option.trim()).filter(Boolean);
      if (!question || options.length < 2) return;
      const spectrum = await loadSpectrum();
      if (!spectrum) return;
      try {
        await sendCraft(spectrum.poll(question, options));
      } catch {
        return;
      }
    },
    sendRichLink: async (link: LodgeRichLink) => {
      const url = link.url.trim();
      if (!url) return;
      const spectrum = await loadSpectrum();
      if (!spectrum) return;
      try {
        await sendCraft(spectrum.richlink(url));
      } catch {
        return;
      }
    },
  };
}

async function loadSpectrum(): Promise<SpectrumCraft | undefined> {
  if (spectrumCraft) return spectrumCraft;
  try {
    spectrumCraft = await import("spectrum-ts");
    return spectrumCraft;
  } catch {
    return undefined;
  }
}

async function invoke(
  fn: (...args: unknown[]) => unknown,
  thisArg: unknown,
  ...args: unknown[]
): Promise<unknown> {
  try {
    return await fn.call(thisArg, ...args);
  } catch {
    return CRAFT_FAILED;
  }
}

async function lodgeAppBuilder(card: LodgeAppCard) {
  const url = card.url.trim();
  if (!url) return undefined;
  const title = card.title?.trim() || "Lodge";
  const spectrum = await loadSpectrum();
  if (!spectrum) return undefined;
  try {
    return spectrum.app(url, {
      layout: {
        caption: title,
        summary: title,
      },
    });
  } catch {
    return undefined;
  }
}

function messageIdOf(value: unknown): string {
  return stringValue(record(value).id);
}

function classifyInbound(
  message: UnknownRecord,
  content: UnknownRecord,
): { accepted: true; content: InboundContent; text: string } | { accepted: false; reason: string } {
  const reaction = lodgeReactionOf(message, content);
  if (reaction) {
    const inbound: LodgeReactionInbound = { type: "unsupported", kind: reaction };
    return { accepted: true, content: inbound, text: LODGE_REACTION_EMOJI[reaction] };
  }
  if (message.reactionRecord || stringValue(content.type) === "reaction") {
    return { accepted: false, reason: "reaction" };
  }

  const pollVote = pollVoteOf(content);
  if (pollVote) {
    const inbound: LodgePollVoteInbound = {
      type: "unsupported",
      kind: "poll_vote",
      option: pollVote,
    };
    return { accepted: true, content: inbound as InboundContent, text: pollVote };
  }
  if (stringValue(content.type) === "poll_option") {
    return { accepted: false, reason: "non-text" };
  }

  const image = imageOf(message, content);
  if (image) {
    return { accepted: true, content: image as InboundContent, text: "" };
  }

  if (stringValue(content.type) === "text") {
    const text = stringValue(content.text).trim();
    return { accepted: true, content: { type: "text", text }, text };
  }
  return { accepted: false, reason: "non-text" };
}

function lodgeReactionOf(message: UnknownRecord, content: UnknownRecord): ConversationReaction | undefined {
  const reactionRecord = record(message.reactionRecord);
  if (Object.keys(reactionRecord).length > 0) {
    if (reactionRecord.selected === false) return undefined;
    const kind = stringValue(record(reactionRecord.reaction).kind);
    if (isLodgeReaction(kind)) return kind;
    const fromRecordEmoji = emojiToReaction(stringValue(record(reactionRecord.reaction).emoji));
    if (fromRecordEmoji) return fromRecordEmoji;
  }
  if (stringValue(content.type) !== "reaction") return undefined;
  const fromEmoji = emojiToReaction(stringValue(content.emoji));
  if (fromEmoji) return fromEmoji;
  const kind = stringValue(content.kind);
  return isLodgeReaction(kind) ? kind : undefined;
}

function isLodgeReaction(value: string): value is ConversationReaction {
  return LODGE_REACTION_KINDS.has(value);
}

function emojiToReaction(emoji: string): ConversationReaction | undefined {
  const trimmed = emoji.trim();
  if (!trimmed) return undefined;
  return EMOJI_TO_REACTION[trimmed] ?? EMOJI_TO_REACTION[trimmed.replace(/\uFE0F/g, "")];
}

function pollVoteOf(content: UnknownRecord): string | undefined {
  if (stringValue(content.type) !== "poll_option") return undefined;
  if (content.selected === false) return undefined;
  const option = stringValue(content.title).trim()
    || stringValue(record(content.option).title).trim();
  return option || undefined;
}

function imageOf(message: UnknownRecord, content: UnknownRecord): LodgeImageInbound | undefined {
  if (isSticker(message, content)) return undefined;
  const direct = imageFromAttachment(content);
  if (direct) return direct;
  if (stringValue(content.type) !== "group" || !Array.isArray(content.items)) return undefined;
  for (const item of content.items) {
    const nested = unwrapContent(record(record(item).content));
    if (isSticker(record(item), nested)) continue;
    const found = imageFromAttachment(nested);
    if (found) return found;
  }
  return undefined;
}

function imageFromAttachment(content: UnknownRecord): LodgeImageInbound | undefined {
  if (stringValue(content.type) !== "attachment") return undefined;
  const mimeType = stringValue(content.mimeType);
  const fileName = stringValue(content.name);
  if (!isImageAttachment(mimeType, fileName)) return undefined;
  const inbound: LodgeImageInbound = {
    type: "unsupported",
    kind: "image",
    mimeType: mimeType || "image/*",
  };
  const read = functionValue(content.read);
  if (read) inbound.read = async () => await read();
  return inbound;
}

function isSticker(message: UnknownRecord, content: UnknownRecord): boolean {
  if (content.isSticker === true) return true;
  const metadata = message.attachmentMetadata;
  if (!Array.isArray(metadata)) return false;
  return metadata.some((item) => record(item).isSticker === true);
}

function isImageAttachment(mimeType: string, fileName: string): boolean {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/") && !mime.includes("svg")) return true;
  if (
    mime.includes("public.jpeg")
    || mime.includes("public.png")
    || mime.includes("public.heic")
    || mime.includes("public.heif")
    || mime.includes("public.tiff")
  ) return true;
  return /\.(jpe?g|png|heic|heif|webp|gif|tif?f)$/i.test(fileName);
}

function unwrapContent(content: UnknownRecord): UnknownRecord {
  let current = content;
  for (let depth = 0; depth < 3 && stringValue(current.type) === "reply"; depth += 1) {
    const inner = current.content;
    if (typeof inner !== "object" || inner === null) break;
    current = record(inner);
  }
  return current;
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
