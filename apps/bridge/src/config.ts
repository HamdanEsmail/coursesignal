import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Load the Git-ignored workspace env file without ever echoing its values. */
export function loadLocalEnvironment(): void {
  const sourceDirectory = dirname(fileURLToPath(import.meta.url));
  const path = resolve(sourceDirectory, "../../..", ".env.local");
  if (existsSync(path)) process.loadEnvFile(path);
}

export function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

export function numberEnvironment(name: string, fallback: number): number {
  const value = Number(optionalEnvironment(name));
  return Number.isFinite(value) ? value : fallback;
}

export function booleanEnvironment(name: string, fallback = false): boolean {
  const value = optionalEnvironment(name)?.toLowerCase();
  if (value === undefined) return fallback;
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function optionalEnvironment(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}
