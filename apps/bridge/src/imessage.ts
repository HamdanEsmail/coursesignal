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

// Node exits immediately on an unhandled rejection or exception. For an
// always-on bridge that would drop in-flight replies without a log line, so
// log the failure, drain through the ordinary shutdown path, and hard-exit if
// the drain itself hangs. The container restarts the replica.
function failFast(event: string, reason: unknown): void {
  logger.error(event, {
    errorType: reason instanceof Error ? reason.name : typeof reason,
  });
  requestShutdown(event);
  setTimeout(() => process.exit(1), 15_000).unref();
}
process.once("unhandledRejection", (reason) => failFast("process.unhandled_rejection", reason));
process.once("uncaughtException", (error) => failFast("process.uncaught_exception", error));

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
