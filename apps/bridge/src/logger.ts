import { createHmac } from "node:crypto";
import type { BridgeLogger } from "./types.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 5,
  info: 10,
  warn: 20,
  error: 30,
};

function errorCode(error: unknown): string {
  if (error instanceof Error) return error.name || "Error";
  return typeof error;
}

function safeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (/message|text|body|query|phone|email|sender|secret|token/i.test(key)) continue;
    if (value instanceof Error) {
      output[key] = errorCode(value);
      continue;
    }
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      output[key] = value;
    }
  }
  return output;
}

export class StructuredLogger implements BridgeLogger {
  readonly #minimum: LogLevel;
  readonly #secret: string;
  readonly #write: (line: string) => void;

  constructor(options: {
    minimum?: LogLevel;
    secret: string;
    write?: (line: string) => void;
  }) {
    this.#minimum = options.minimum ?? "info";
    this.#secret = options.secret;
    this.#write = options.write ?? ((line) => process.stdout.write(`${line}\n`));
  }

  ref(value: string): string {
    return createHmac("sha256", this.#secret).update(value).digest("hex").slice(0, 12);
  }

  debug(event: string, fields: Record<string, unknown> = {}): void {
    this.#log("debug", event, fields);
  }

  info(event: string, fields: Record<string, unknown> = {}): void {
    this.#log("info", event, fields);
  }

  warn(event: string, fields: Record<string, unknown> = {}): void {
    this.#log("warn", event, fields);
  }

  error(event: string, fields: Record<string, unknown> = {}): void {
    this.#log("error", event, fields);
  }

  #log(level: LogLevel, event: string, fields: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.#minimum]) return;
    this.#write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        event,
        ...safeFields(fields),
      }),
    );
  }
}

export const silentLogger: BridgeLogger = {
  ref: (value) => value.slice(0, 12),
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
