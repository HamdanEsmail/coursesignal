import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { numberEnvironment, optionalEnvironment, requiredEnvironment } from "./config.js";
import { CourseSignalBridge } from "./handler.js";
import { StructuredLogger } from "./logger.js";
import { opaqueIdentifier } from "./identifiers.js";
import { createTinyFishResearchService } from "./research.js";
import { InMemoryBridgeStore, JsonFileBridgeStore } from "./store.js";
import { createSupabaseBridgeStore } from "./supabase-store.js";
import type { BridgeStore } from "./types.js";

export type BridgeStoreBackend = "json" | "supabase";

export function configuredBridgeStoreBackend(): BridgeStoreBackend {
  const configured = optionalEnvironment("COURSESIGNAL_STORE")?.toLowerCase() ?? "json";
  if (configured === "json" || configured === "supabase") return configured;
  throw new Error("COURSESIGNAL_STORE must be either json or supabase.");
}

export function createConfiguredBridge(options: {
  stateSecret: string;
  durable?: boolean;
}): { bridge: CourseSignalBridge; logger: StructuredLogger } {
  const logger = new StructuredLogger({
    secret: options.stateSecret,
    minimum: optionalEnvironment("COURSESIGNAL_LOG_LEVEL") === "debug" ? "debug" :
      optionalEnvironment("COURSESIGNAL_LOG_LEVEL") === "error" ? "error" :
        optionalEnvironment("COURSESIGNAL_LOG_LEVEL") === "warn" ? "warn" : "info",
  });
  const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const configuredStatePath = optionalEnvironment("COURSESIGNAL_STATE_PATH");
  const statePath = configuredStatePath
    ? isAbsolute(configuredStatePath) ? configuredStatePath : resolve(workspaceRoot, configuredStatePath)
    :
    join(
      workspaceRoot,
      "private-handoff",
      `bridge-state-v1-${opaqueIdentifier(
        "deployment",
        optionalEnvironment("SPECTRUM_PROJECT_ID") ?? "local",
        options.stateSecret,
      ).slice(0, 12)}.json`,
    );
  const store: BridgeStore = options.durable === false
    ? new InMemoryBridgeStore()
    : configuredBridgeStoreBackend() === "supabase"
      ? createSupabaseBridgeStore(
        requiredEnvironment("SUPABASE_URL"),
        requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
      )
      : new JsonFileBridgeStore(statePath);

  return {
    logger,
    bridge: new CourseSignalBridge({
      store,
      research: createTinyFishResearchService(),
      logger,
      debounceMs: numberEnvironment("COURSESIGNAL_DEBOUNCE_MS", 300),
    }),
  };
}
