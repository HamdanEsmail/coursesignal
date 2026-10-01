import { createHash } from "node:crypto";
import type { ProviderOperationState } from "@coursesignal/contracts";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const CLOCK_PATTERN = /^(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d)$/;

export class PayloadHashMismatchError extends Error {
  readonly code = "PAYLOAD_HASH_MISMATCH";

  constructor(readonly idempotencyKey: string) {
    super(`Idempotency key ${idempotencyKey} was reused with a different payload.`);
    this.name = "PayloadHashMismatchError";
  }
}

export class BudgetExceededError extends Error {
  readonly code = "BUDGET_EXCEEDED";

  constructor(
    readonly requestedUnits: number,
    readonly availableUnits: number,
  ) {
    super(
      `Cannot reserve ${requestedUnits} units; only ${availableUnits} units remain.`,
    );
    this.name = "BudgetExceededError";
  }
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Stable JSON for payload hashes; secrets and raw identifiers must be removed first. */
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();

  const visit = (item: unknown): unknown => {
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean"
    ) {
      return item;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new TypeError("Non-finite numbers are not JSON values.");
      return item;
    }
    if (typeof item === "bigint" || typeof item === "symbol" || typeof item === "function") {
      throw new TypeError("Value is not JSON serializable.");
    }
    if (typeof item === "undefined") return null;
    if (item instanceof Date) return item.toISOString();
    if (Array.isArray(item)) {
      if (seen.has(item)) throw new TypeError("Circular JSON payload.");
      seen.add(item);
      const result = item.map(visit);
      seen.delete(item);
      return result;
    }
    if (typeof item === "object") {
      if (seen.has(item)) throw new TypeError("Circular JSON payload.");
      seen.add(item);
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(item).sort()) {
        const child = (item as Record<string, unknown>)[key];
        if (typeof child !== "undefined") result[key] = visit(child);
      }
      seen.delete(item);
      return result;
    }
    throw new TypeError("Value is not JSON serializable.");
  };

  return JSON.stringify(visit(value));
}

export function hashCanonicalPayload(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

function assertSha256(value: string): void {
  if (!SHA_256_PATTERN.test(value)) throw new TypeError("Invalid SHA-256 digest.");
}

export type ReplayDisposition = "new" | "duplicate";

export function classifyReplay(
  idempotencyKey: string,
  existingPayloadHash: string | null,
  incomingPayloadHash: string,
): ReplayDisposition {
  assertSha256(incomingPayloadHash);
  if (existingPayloadHash === null) return "new";
  assertSha256(existingPayloadHash);
  if (existingPayloadHash !== incomingPayloadHash) {
    throw new PayloadHashMismatchError(idempotencyKey);
  }
  return "duplicate";
}

export type BudgetWindow = {
  limitUnits: number;
  reservedUnits: number;
  consumedUnits: number;
};

export function availableBudget(window: BudgetWindow): number {
  validateBudget(window);
  return window.limitUnits - window.reservedUnits - window.consumedUnits;
}

export function reserveBudget(window: BudgetWindow, units: number): BudgetWindow {
  validatePositiveUnits(units);
  const available = availableBudget(window);
  if (units > available) throw new BudgetExceededError(units, available);
  return { ...window, reservedUnits: window.reservedUnits + units };
}

export function consumeBudget(window: BudgetWindow, units: number): BudgetWindow {
  validatePositiveUnits(units);
  validateBudget(window);
  if (units > window.reservedUnits) {
    throw new RangeError("Cannot consume more units than are reserved.");
  }
  return {
    ...window,
    reservedUnits: window.reservedUnits - units,
    consumedUnits: window.consumedUnits + units,
  };
}

export function releaseBudget(window: BudgetWindow, units: number): BudgetWindow {
  validatePositiveUnits(units);
  validateBudget(window);
  if (units > window.reservedUnits) {
    throw new RangeError("Cannot release more units than are reserved.");
  }
  return { ...window, reservedUnits: window.reservedUnits - units };
}

function validateBudget(window: BudgetWindow): void {
  for (const value of [window.limitUnits, window.reservedUnits, window.consumedUnits]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError("Budget units must be non-negative safe integers.");
    }
  }
  if (window.reservedUnits + window.consumedUnits > window.limitUnits) {
    throw new RangeError("Reserved and consumed units exceed the budget limit.");
  }
}

function validatePositiveUnits(units: number): void {
  if (!Number.isSafeInteger(units) || units <= 0) {
    throw new TypeError("Reservation units must be a positive safe integer.");
  }
}

export type ProviderOperation = {
  idempotencyKey: string;
  payloadHash: string;
  state: ProviderOperationState;
  reservedUnits: number;
};

export type ProviderReservation = {
  disposition: "reserved" | "duplicate";
  operation: ProviderOperation;
  budget: BudgetWindow;
};

/**
 * Pure admission reducer mirrored by the SQL transaction. A duplicate is
 * never re-billed, and failed/uncertain operations are never blindly retried.
 */
export function reserveProviderOperation(
  existing: ProviderOperation | null,
  request: Omit<ProviderOperation, "state">,
  budget: BudgetWindow,
): ProviderReservation {
  const replay = classifyReplay(
    request.idempotencyKey,
    existing?.payloadHash ?? null,
    request.payloadHash,
  );
  if (replay === "duplicate" && existing) {
    return { disposition: "duplicate", operation: existing, budget };
  }

  const nextBudget = reserveBudget(budget, request.reservedUnits);
  return {
    disposition: "reserved",
    operation: { ...request, state: "reserved" },
    budget: nextBudget,
  };
}

export type LocalClock = { hour: number; minute: number };

export function localClockAt(instant: Date, timeZone: string): LocalClock {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(instant);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new RangeError(`Could not resolve local clock for ${timeZone}.`);
  }
  return { hour, minute };
}

export function isWithinQuietHours(
  clock: LocalClock,
  quietStart: string,
  quietEnd: string,
): boolean {
  if (
    !Number.isInteger(clock.hour) ||
    clock.hour < 0 ||
    clock.hour > 23 ||
    !Number.isInteger(clock.minute) ||
    clock.minute < 0 ||
    clock.minute > 59
  ) {
    throw new TypeError("Local clock must contain a valid hour and minute.");
  }
  const current = clock.hour * 60 + clock.minute;
  const start = parseClock(quietStart);
  const end = parseClock(quietEnd);

  if (start === end) return false;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

export function shouldDeliverWatch(input: {
  instant: Date;
  timeZone: string;
  quietStart: string;
  quietEnd: string;
}): { deliver: boolean; reason: "allowed" | "quiet_hours" } {
  const quiet = isWithinQuietHours(
    localClockAt(input.instant, input.timeZone),
    input.quietStart,
    input.quietEnd,
  );
  return quiet
    ? { deliver: false, reason: "quiet_hours" }
    : { deliver: true, reason: "allowed" };
}

function parseClock(value: string): number {
  const match = CLOCK_PATTERN.exec(value);
  if (!match?.groups) throw new TypeError(`Invalid local clock: ${value}`);
  return Number(match.groups.hour) * 60 + Number(match.groups.minute);
}
