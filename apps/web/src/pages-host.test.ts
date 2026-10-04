import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webRoot = fileURLToPath(new URL("..", import.meta.url));

describe("Pages Direct Upload host files", () => {
  it("does not rewrite /add.ics onto the SPA HTML fallback", () => {
    const redirects = readFileSync(path.join(webRoot, "public/_redirects"), "utf8");
    expect(redirects).toMatch(/^\/slip \/ 200$/m);
    expect(redirects).toMatch(/^\/add \/ 200$/m);
    expect(redirects).not.toMatch(/\/add\.ics\s+/);
    expect(redirects).not.toMatch(/^\/\* /m);
  });

  it("invokes the uploaded worker only for /add.ics", () => {
    const routes = JSON.parse(readFileSync(path.join(webRoot, "public/_routes.json"), "utf8")) as {
      version: number;
      include: string[];
    };
    expect(routes.version).toBe(1);
    expect(routes.include).toEqual(["/add.ics"]);
  });
});
