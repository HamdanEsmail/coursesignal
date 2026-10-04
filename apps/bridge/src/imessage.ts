import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { loadLocalEnvironment, requiredEnvironment } from "./config.js";
import { routeIMessageEvent } from "./imessage-adapter.js";
import { BridgeHealthState, startOptionalHealthServer } from "./health.js";
import { runWithReconnect } from "./reconnect.js";
import { opaqueIdentifier } from "./identifiers.js";
import { createLodgeBridgeStack } from "./scheduler.js";
import { liveSpaceFromUnknown, reopenFromSpectrumClient } from "./space-registry.js";

loadLocalEnvironment();

const projectId = requiredEnvironment("SPECTRUM_PROJECT_ID");
const projectSecret = requiredEnvironment("SPECTRUM_PROJECT_SECRET");
const stateSecret = process.env.COURSESIGNAL_STATE_SECRET?.trim() || projectSecret;
const { bridge, logger, spaces, scheduler } = await createLodgeBridgeStack({ stateSecret });
const shutdown = new AbortController();
const health = new BridgeHealthState();
const healthServer = await startOptionalHealthServer({ state: health, logger });
scheduler.start(shutdown.signal);

function requestShutdown(signal: string): void {
  logger.info("process.shutdown_requested", { signal });
  health.setTransport("stopping");
  shutdown.abort(new Error(signal));
}

process.once("SIGINT", () => requestShutdown("SIGINT"));
process.once("SIGTERM", () => requestShutdown("SIGTERM"));

try {
  await runWithReconnect({
    signal: shutdown.signal,
    logger,
    onStateChange: (state) => health.setTransport(state),
    connect: async () => {
      spaces.forgetAllLive();
      const client = await Spectrum({
        projectId,
        projectSecret,
        providers: [imessage.config({})],
        options: { logLevel: "warn" },
      });
      scheduler.setReopen(reopenFromSpectrumClient(client));
      return client;
    },
    onMessage: async ([space, message]) => {
      const live = liveSpaceFromUnknown(space);
      if (live) {
        try {
          await spaces.registerLive(
            opaqueIdentifier("conversation", live.id, stateSecret),
            live,
          );
        } catch (error) {
          logger.warn("scheduler.space_register_failed", {
            errorType: error instanceof Error ? error.name : typeof error,
          });
        }
      }
      await routeIMessageEvent({
        space,
        message,
        stateSecret,
        logger,
        handle: (envelope, port) => bridge.handle(envelope, port),
      });
    },
  });
} finally {
  health.setTransport("stopping");
  scheduler.stop();
  await bridge.drain();
  await healthServer?.stop();
  logger.info("process.stopped");
}
