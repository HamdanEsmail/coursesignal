import type { BridgeLogger } from "./types.js";

export interface ReconnectableMessageClient<T> {
  messages: AsyncIterable<T>;
  stop(): Promise<void>;
}

export type ReconnectState = "connecting" | "connected" | "reconnecting" | "stopping";

export async function runWithReconnect<T>(options: {
  connect: () => Promise<ReconnectableMessageClient<T>>;
  onMessage: (message: T) => Promise<void>;
  logger: BridgeLogger;
  signal: AbortSignal;
  initialBackoffMs?: number;
  maximumBackoffMs?: number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  onStateChange?: (state: ReconnectState) => void;
}): Promise<void> {
  const initialBackoffMs = Math.max(25, options.initialBackoffMs ?? 1_000);
  const maximumBackoffMs = Math.max(initialBackoffMs, options.maximumBackoffMs ?? 30_000);
  const sleep = options.sleep ?? abortableSleep;
  let failures = 0;

  while (!options.signal.aborted) {
    options.onStateChange?.("connecting");
    let client: ReconnectableMessageClient<T> | undefined;
    const inFlight = new Set<Promise<void>>();
    const connectedAt = Date.now();
    const stopOnAbort = (): void => {
      void client?.stop().catch(() => undefined);
    };

    try {
      client = await options.connect();
      options.signal.addEventListener("abort", stopOnAbort, { once: true });
      options.logger.info("transport.connected", { attempt: failures + 1 });
      options.onStateChange?.("connected");

      for await (const item of client.messages) {
        if (options.signal.aborted) break;
        const task = options.onMessage(item).catch((error) => {
          options.logger.error("transport.message_failed", {
            errorType: error instanceof Error ? error.name : typeof error,
          });
        });
        inFlight.add(task);
        void task.finally(() => inFlight.delete(task));
      }

      if (!options.signal.aborted) throw new Error("MessageStreamEnded");
    } catch (error) {
      if (!options.signal.aborted) {
        options.onStateChange?.("reconnecting");
        options.logger.warn("transport.disconnected", {
          errorType: error instanceof Error ? error.name : typeof error,
          attempt: failures + 1,
        });
      }
    } finally {
      options.signal.removeEventListener("abort", stopOnAbort);
      await Promise.allSettled([...inFlight]);
      await client?.stop().catch(() => undefined);
    }

    if (options.signal.aborted) break;
    if (Date.now() - connectedAt > 30_000) failures = 0;
    const backoff = Math.min(maximumBackoffMs, initialBackoffMs * 2 ** failures);
    failures += 1;
    options.logger.info("transport.reconnect_scheduled", { backoffMs: backoff });
    await sleep(backoff, options.signal).catch(() => undefined);
  }
  options.onStateChange?.("stopping");
}

export function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}
