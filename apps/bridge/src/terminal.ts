import { Spectrum } from "spectrum-ts";
import { terminal } from "spectrum-ts/providers/terminal";
import { createConfiguredBridge } from "./bootstrap.js";
import { loadLocalEnvironment } from "./config.js";
import { opaqueIdentifier } from "./identifiers.js";
import type { ConversationPort, InboundEnvelope } from "./types.js";

loadLocalEnvironment();

const stateSecret = process.env.COURSESIGNAL_STATE_SECRET?.trim() || "coursesignal-local-terminal";
const { bridge } = createConfiguredBridge({ stateSecret, durable: false });
const app = await Spectrum({ providers: [terminal.config()] });
let stopping = false;

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await bridge.drain();
  await app.stop();
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

for await (const [space, message] of app.messages) {
  if (stopping || message.direction === "outbound") continue;
  const envelope: InboundEnvelope = {
    eventKey: opaqueIdentifier("terminal-event", message.id, stateSecret),
    conversationKey: opaqueIdentifier("terminal-conversation", space.id, stateSecret),
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
