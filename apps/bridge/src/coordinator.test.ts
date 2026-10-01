import { describe, expect, it } from "vitest";
import { ConversationCoordinator } from "./coordinator.js";

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

describe("ConversationCoordinator", () => {
  it("debounces a burst into one batch", async () => {
    const batches: number[][] = [];
    const coordinator = new ConversationCoordinator<number>({
      debounceMs: 5,
      consume: async (_key, items) => void batches.push(items),
    });
    const first = coordinator.enqueue("a", 1);
    const second = coordinator.enqueue("a", 2);
    await Promise.all([first, second]);
    expect(batches).toEqual([[1, 2]]);
  });

  it("serializes one conversation while allowing another to progress", async () => {
    const active = new Map<string, number>();
    const peaks = new Map<string, number>();
    let globalPeak = 0;
    let globalActive = 0;
    const coordinator = new ConversationCoordinator<number>({
      debounceMs: 1,
      consume: async (key) => {
        active.set(key, (active.get(key) ?? 0) + 1);
        peaks.set(key, Math.max(peaks.get(key) ?? 0, active.get(key) ?? 0));
        globalActive += 1;
        globalPeak = Math.max(globalPeak, globalActive);
        await delay(15);
        active.set(key, (active.get(key) ?? 1) - 1);
        globalActive -= 1;
      },
    });

    const a1 = coordinator.enqueue("a", 1);
    await delay(3);
    const a2 = coordinator.enqueue("a", 2);
    const b1 = coordinator.enqueue("b", 3);
    await Promise.all([a1, a2, b1]);

    expect(peaks.get("a")).toBe(1);
    expect(globalPeak).toBeGreaterThan(1);
  });

  it("flushes pending work during drain", async () => {
    const seen: string[] = [];
    const coordinator = new ConversationCoordinator<string>({
      debounceMs: 10_000,
      consume: async (_key, items) => void seen.push(...items),
    });
    const work = coordinator.enqueue("chat", "pending");
    await coordinator.drain();
    await work;
    expect(seen).toEqual(["pending"]);
  });
});
