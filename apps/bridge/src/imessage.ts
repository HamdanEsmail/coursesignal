import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { createConfiguredBridge } from "./bootstrap.js";
import { loadLocalEnvironment, requiredEnvironment } from "./config.js";
import { routeIMessageEvent } from "./imessage-adapter.js";
import { BridgeHealthState, startOptionalHealthServer } from "./health.js";
import { runWithReconnect } from "./reconnect.js";

loadLocalEnvironment();

const projectId = requiredEnvironment("SPECTRUM_PROJECT_ID");
const projectSecret = requiredEnvironment("SPECTRUM_PROJECT_SECRET");
const stateSecret = process.env.COURSESIGNAL_STATE_SECRET?.trim() || projectSecret;
const { bridge, logger } = createConfiguredBridge({ stateSecret });
const shutdown = new AbortController();
const health = new BridgeHealthState();
const healthServer = await startOptionalHealthServer({ state: health, logger });

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
    connect: () => Spectrum({
      projectId,
      projectSecret,
      providers: [imessage.config({})],
      options: { logLevel: "warn" },
    }),
    onMessage: async ([space, message]) => {
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
  await bridge.drain();
  await healthServer?.stop();
  logger.info("process.stopped");
}
