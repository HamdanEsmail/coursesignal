import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  PAGES_REDIRECTS,
  PAGES_ROUTES,
  buildPagesManifest,
  ensurePagesHostFiles,
  pagesAssetKey,
} from "./pages-direct-upload.mjs";

describe("Pages Direct Upload asset keys", () => {
  it("always emits a single leading slash, including the 404 regression names", () => {
    assert.equal(pagesAssetKey("index.html"), "/index.html");
    assert.equal(pagesAssetKey("/index.html"), "/index.html");
    assert.equal(pagesAssetKey("//index.html"), "/index.html");
    assert.equal(pagesAssetKey("assets\\app.js"), "/assets/app.js");
    assert.equal(pagesAssetKey("_worker.js"), "/_worker.js");
    assert.equal(pagesAssetKey("_redirects"), "/_redirects");
    assert.equal(pagesAssetKey("_routes.json"), "/_routes.json");
  });

  it("builds a manifest that Functions can resolve (never bare index.html)", () => {
    const manifest = buildPagesManifest([
      { name: "index.html", hash: "htmlhash" },
      { name: "/favicon.svg", hash: "svghash" },
      { name: "assets\\index.js", hash: "jshash" },
    ]);
    assert.deepEqual(manifest, {
      "/index.html": "htmlhash",
      "/favicon.svg": "svghash",
      "/assets/index.js": "jshash",
    });
    for (const key of Object.keys(manifest)) {
      assert.equal(key.startsWith("/"), true, key);
    }
    assert.equal(Object.hasOwn(manifest, "index.html"), false);
  });
});

describe("Pages Direct Upload host files", () => {
  it("rewrites /slip and /add to / and scopes _worker.js to /add.ics", () => {
    assert.match(PAGES_REDIRECTS, /^\/slip \/ 200$/m);
    assert.match(PAGES_REDIRECTS, /^\/add \/ 200$/m);
    assert.doesNotMatch(PAGES_REDIRECTS, /index\.html/);
    assert.doesNotMatch(PAGES_REDIRECTS, /^\/\* /m);
    assert.deepEqual(PAGES_ROUTES, {
      version: 1,
      include: ["/add.ics"],
      exclude: [],
    });
  });

  it("writes those host files into the upload directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pages-host-"));
    try {
      await ensurePagesHostFiles(dir);
      const redirects = await readFile(join(dir, "_redirects"), "utf8");
      const routes = JSON.parse(await readFile(join(dir, "_routes.json"), "utf8"));
      assert.equal(redirects, PAGES_REDIRECTS);
      assert.deepEqual(routes, PAGES_ROUTES);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("matches the committed public/_redirects and public/_routes.json contract", async () => {
    const webRoot = fileURLToPath(new URL("../apps/web/public/", import.meta.url));
    const redirects = await readFile(join(webRoot, "_redirects"), "utf8");
    const routes = JSON.parse(await readFile(join(webRoot, "_routes.json"), "utf8"));
    assert.match(redirects, /^\/slip \/ 200$/m);
    assert.match(redirects, /^\/add \/ 200$/m);
    assert.doesNotMatch(redirects, /index\.html/);
    assert.deepEqual(routes.include, ["/add.ics"]);
  });
});
