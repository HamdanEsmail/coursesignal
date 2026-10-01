import { describe, expect, it } from "vitest";
import {
  BudgetExceededError,
  PayloadHashMismatchError,
  classifyReplay,
  hashCanonicalPayload,
  reserveProviderOperation,
  shouldDeliverWatch,
} from "../../packages/provider-control/src/index.js";

describe("provider control", () => {
  it("hashes equivalent object payloads identically", () => {
    expect(hashCanonicalPayload({ b: 2, a: 1 })).toBe(
      hashCanonicalPayload({ a: 1, b: 2 }),
    );
  });

  it("rejects a repeated id with a mismatched payload hash", () => {
    expect(() => classifyReplay("evt-1", "a".repeat(64), "b".repeat(64))).toThrow(
      PayloadHashMismatchError,
    );
  });

  it("does not reserve budget twice for the same provider operation", () => {
    const budget = { limitUnits: 10, reservedUnits: 0, consumedUnits: 0 };
    const payloadHash = "c".repeat(64);
    const first = reserveProviderOperation(
      null,
      { idempotencyKey: "run-1:search", payloadHash, reservedUnits: 3 },
      budget,
    );
    const duplicate = reserveProviderOperation(
      first.operation,
      { idempotencyKey: "run-1:search", payloadHash, reservedUnits: 3 },
      first.budget,
    );

    expect(first.disposition).toBe("reserved");
    expect(duplicate.disposition).toBe("duplicate");
    expect(duplicate.budget.reservedUnits).toBe(3);
  });

  it("fails closed when a provider reservation exceeds its budget", () => {
    expect(() =>
      reserveProviderOperation(
        null,
        {
          idempotencyKey: "run-2:agent",
          payloadHash: "d".repeat(64),
          reservedUnits: 6,
        },
        { limitUnits: 5, reservedUnits: 0, consumedUnits: 0 },
      ),
    ).toThrow(BudgetExceededError);
  });

  it("suppresses watches during cross-midnight Dubai quiet hours", () => {
    expect(
      shouldDeliverWatch({
        instant: new Date("2026-10-01T19:30:00.000Z"),
        timeZone: "Asia/Dubai",
        quietStart: "22:00",
        quietEnd: "08:00",
      }),
    ).toEqual({ deliver: false, reason: "quiet_hours" });

    expect(
      shouldDeliverWatch({
        instant: new Date("2026-10-01T08:00:00.000Z"),
        timeZone: "Asia/Dubai",
        quietStart: "22:00",
        quietEnd: "08:00",
      }),
    ).toEqual({ deliver: true, reason: "allowed" });
  });
});
