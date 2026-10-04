import { Spectrum } from "spectrum-ts";
import { terminal } from "spectrum-ts/providers/terminal";
import { loadLocalEnvironment } from "./config.js";
import { opaqueIdentifier } from "./identifiers.js";
import type { ConversationPort, InboundEnvelope } from "./types.js";
import { createLodgeBridgeStack } from "./scheduler.js";
import { liveSpaceFromUnknown, reopenFromSpectrumClient } from "./space-registry.js";

loadLocalEnvironment();

const stateSecret = process.env.COURSESIGNAL_STATE_SECRET?.trim() || "coursesignal-local-terminal";
const { bridge, logger, spaces, scheduler } = await createLodgeBridgeStack({
  stateSecret,
  durable: false,
});
const app = await Spectrum({ providers: [terminal.config()] });
scheduler.setReopen(reopenFromSpectrumClient(app));
scheduler.start();
let stopping = false;

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  scheduler.stop();
  await bridge.drain();
  await app.stop();
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

for await (const [space, message] of app.messages) {
  if (stopping || message.direction === "outbound") continue;
  const conversationKey = opaqueIdentifier("terminal-conversation", space.id, stateSecret);
  const live = liveSpaceFromUnknown(space);
  if (live) {
    try {
      await spaces.registerLive(conversationKey, live);
    } catch (error) {
      logger.warn("scheduler.space_register_failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
  }
  const envelope: InboundEnvelope = {
    eventKey: opaqueIdentifier("terminal-event", message.id, stateSecret),
    conversationKey,
    receivedAt: message.timestamp.toISOString(),
    content: message.content.type === "text"
      ? { type: "text", text: message.content.text }
      : { type: "unsupported", kind: message.content.type },
  };
  const port: ConversationPort = {
    send: async (body) => void await space.send(body),
    startTyping: async () => void await space.startTyping(),
    stopTyping: async () => void await space.stopTyping(),
  };
  await bridge.handle(envelope, port);
}

await stop();
