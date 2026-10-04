import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("marketing copy", () => {
  it("keeps engineer words off the student pages", () => {
    const files = [
      "src/App.tsx",
      "src/components/DayStage.tsx",
      "src/components/DayPhone.tsx",
      "src/components/DemoReel.tsx",
      "src/data/day.ts",
    ].map((file) => readFileSync(path.join(root, file), "utf8"));
    const corpus = files.join("\n");
    expect(corpus).not.toMatch(/HMAC|Cloudflare|OpenRouter|TinyFish|Photon|CourseSignal|STAT 210|\bICS\b|apps\/web\/public\/demo\.mp4/i);
  });
});
