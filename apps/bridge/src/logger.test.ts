import { describe, expect, it } from "vitest";
import { opaqueIdentifier } from "./identifiers.js";
import { StructuredLogger } from "./logger.js";

describe("opaqueIdentifier", () => {
  it("is stable within a namespace and different across namespaces", () => {
    const first = opaqueIdentifier("conversation", "+971500000000", "secret");
    expect(first).toBe(opaqueIdentifier("conversation", "+971500000000", "secret"));
    expect(first).not.toBe(opaqueIdentifier("sender", "+971500000000", "secret"));
    expect(first).not.toContain("9715");
  });
});

describe("StructuredLogger", () => {
  it("drops fields that could expose content or identifiers", () => {
    const lines: string[] = [];
    const logger = new StructuredLogger({ secret: "secret", write: (line) => void lines.push(line) });
    logger.info("test", {
      conversationRef: logger.ref("raw-conversation"),
      body: "private question",
      phone: "+971500000000",
      sourceCount: 2,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("private question");
    expect(lines[0]).not.toContain("+971");
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ event: "test", sourceCount: 2 });
  });
});
