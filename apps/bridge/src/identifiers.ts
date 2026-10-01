import { createHmac } from "node:crypto";

/**
 * Provider identifiers can contain phone numbers or Apple IDs. Convert them to
 * stable opaque keys before persistence or logging.
 */
export function opaqueIdentifier(namespace: string, value: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(namespace)
    .update("\0")
    .update(value)
    .digest("hex");
}
