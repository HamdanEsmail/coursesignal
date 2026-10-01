import { describe, expect, it, vi } from "vitest";
import { runWithReconnect, type ReconnectableMessageClient } from "./reconnect.js";
import { silentLogger } from "./logger.js";

function client<T>(messages: AsyncIterable<T>, stop = vi.fn(async () => undefined)):
  ReconnectableMessageClient<T> & { stop: ReturnType<typeof vi.fn> } {
  return { messages, stop };
}

describe("runWithReconnect", () => {
  it("reconnects after the provider stream fails", async () => {
    const abort = new AbortController();
    const first = client((async function* () {
      throw new Error("socket closed");
      yield "never";
    })());
    const second = client((async function* () { yield "message"; })());
    const connect = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const seen: string[] = [];
    const sleeps: number[] = [];
    const states: string[] = [];

    await runWithReconnect<string>({
      connect,
      logger: silentLogger,
      signal: abort.signal,
      initialBackoffMs: 25,
      sleep: async (milliseconds) => void sleeps.push(milliseconds),
      onStateChange: (state) => void states.push(state),
      onMessage: async (message) => {
        seen.push(message);
        abort.abort();
      },
    });

    expect(connect).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([25]);
    expect(seen).toEqual(["message"]);
    expect(first.stop).toHaveBeenCalled();
    expect(second.stop).toHaveBeenCalled();
    expect(states).toEqual([
      "connecting",
      "connected",
      "reconnecting",
      "connecting",
      "connected",
      "stopping",
    ]);
  });

  it("waits for in-flight message work before returning on shutdown", async () => {
    const abort = new AbortController();
    let finished = false;
    const connected = client((async function* () { yield 1; })());
    await runWithReconnect({
      connect: async () => connected,
      logger: silentLogger,
      signal: abort.signal,
      onMessage: async () => {
        abort.abort();
        await new Promise((resolve) => setTimeout(resolve, 5));
        finished = true;
      },
    });
    expect(finished).toBe(true);
    expect(connected.stop).toHaveBeenCalled();
  });
});
