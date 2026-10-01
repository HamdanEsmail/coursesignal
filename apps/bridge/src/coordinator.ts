type Pending<T> = {
  item: T;
  resolve: () => void;
  reject: (error: unknown) => void;
};

type ConversationLane<T> = {
  pending: Pending<T>[];
  timer?: ReturnType<typeof setTimeout>;
  tail: Promise<void>;
};

/**
 * Debounces short message bursts, while keeping all work for one conversation
 * ordered. Different conversations can still run concurrently.
 */
export class ConversationCoordinator<T> {
  readonly #debounceMs: number;
  readonly #consume: (conversationKey: string, items: T[]) => Promise<void>;
  readonly #lanes = new Map<string, ConversationLane<T>>();

  constructor(options: {
    debounceMs?: number;
    consume: (conversationKey: string, items: T[]) => Promise<void>;
  }) {
    this.#debounceMs = options.debounceMs ?? 300;
    this.#consume = options.consume;
  }

  enqueue(conversationKey: string, item: T): Promise<void> {
    let lane = this.#lanes.get(conversationKey);
    if (!lane) {
      lane = { pending: [], tail: Promise.resolve() };
      this.#lanes.set(conversationKey, lane);
    }

    const promise = new Promise<void>((resolve, reject) => {
      lane?.pending.push({ item, resolve, reject });
    });

    if (lane.timer) clearTimeout(lane.timer);
    lane.timer = setTimeout(() => this.#flush(conversationKey), this.#debounceMs);
    return promise;
  }

  async drain(): Promise<void> {
    for (const key of [...this.#lanes.keys()]) this.#flush(key);
    await Promise.allSettled([...this.#lanes.values()].map((lane) => lane.tail));
  }

  #flush(conversationKey: string): void {
    const lane = this.#lanes.get(conversationKey);
    if (!lane || lane.pending.length === 0) return;

    if (lane.timer) clearTimeout(lane.timer);
    lane.timer = undefined;
    const batch = lane.pending.splice(0);
    const run = lane.tail
      .catch(() => undefined)
      .then(() => this.#consume(conversationKey, batch.map(({ item }) => item)));

    lane.tail = run;
    void run.then(
      () => batch.forEach(({ resolve }) => resolve()),
      (error) => batch.forEach(({ reject }) => reject(error)),
    ).finally(() => {
      const current = this.#lanes.get(conversationKey);
      if (current === lane && !current.timer && current.pending.length === 0 && current.tail === run) {
        this.#lanes.delete(conversationKey);
      }
    });
  }
}
