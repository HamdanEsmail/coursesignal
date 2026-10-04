import { createRequire } from "node:module";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const accountId = "7a9527c6ccbedc4fe76c02eac18a0390";
const projectName = "coursesignal";
const directory = resolve("apps/web/dist");

const mimeByExtension = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** SPA routes rewrite to `/`. `/index.html` 308s and skips the /add.ics Function. */
export const PAGES_REDIRECTS = "/slip / 200\n/add / 200\n";

/** Advanced Mode `_worker.js` is invoked only for the calendar file. */
export const PAGES_ROUTES = {
  version: 1,
  include: ["/add.ics"],
  exclude: [],
};

/**
 * Pages Direct Upload asset keys must be URL paths.
 * Bare names like `index.html` leave Functions with an empty ASSETS store.
 */
export function pagesAssetKey(relativePath) {
  const posix = String(relativePath ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (!posix) {
    throw new Error("Pages asset key requires a file path");
  }
  return `/${posix}`;
}

export function buildPagesManifest(files) {
  const manifest = Object.fromEntries(
    files.map((file) => [pagesAssetKey(file.name), file.hash]),
  );
  const unprefixed = Object.keys(manifest).filter((key) => !key.startsWith("/"));
  if (unprefixed.length) {
    throw new Error(`Pages manifest keys must start with /; got ${unprefixed.join(", ")}`);
  }
  return manifest;
}

export async function ensurePagesHostFiles(root) {
  await writeFile(join(root, "_redirects"), PAGES_REDIRECTS, "utf8");
  await writeFile(join(root, "_routes.json"), `${JSON.stringify(PAGES_ROUTES, null, 2)}\n`, "utf8");
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(entry).toLowerCase();
}

function loadBlake3() {
  const require = createRequire(resolve("private-handoff/cf-deploy/package.json"));
  return require("blake3-wasm").hash;
}

async function walk(dir, blake3hash, files = [], root = dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const filepath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(filepath, blake3hash, files, root);
      continue;
    }
    if (entry.name === ".DS_Store") continue;
    const relativePath = relative(root, filepath).split(sep).join("/");
    const contents = await readFile(filepath);
    const extension = extname(filepath).substring(1);
    const hash = blake3hash(contents.toString("base64") + extension)
      .toString("hex")
      .slice(0, 32);
    files.push({
      name: pagesAssetKey(relativePath),
      contentType: mimeByExtension[extname(filepath)] || "application/octet-stream",
      sizeInBytes: contents.byteLength,
      hash,
      contents,
    });
  }
  return files;
}

async function cloudflare(jwt, pathname, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await response.json();
  if (!response.ok || body.success === false) {
    throw new Error(`${pathname} failed: ${JSON.stringify(body.errors || body)}`);
  }
  return body.result;
}

async function main() {
  const jwt = (process.env.CF_PAGES_UPLOAD_JWT || "").trim();
  if (!jwt) throw new Error("CF_PAGES_UPLOAD_JWT is not set.");

  await ensurePagesHostFiles(directory);
  const files = await walk(directory, loadBlake3());
  const missing = await cloudflare(jwt, "/pages/assets/check-missing", {
    method: "POST",
    body: JSON.stringify({ hashes: files.map((file) => file.hash) }),
  });
  const missingSet = new Set(missing);
  const toUpload = files.filter((file) => missingSet.has(file.hash));

  const bucketSize = 50 * 1024 * 1024;
  let bucket = [];
  let bucketBytes = 0;
  const buckets = [];
  for (const file of toUpload.sort((a, b) => b.sizeInBytes - a.sizeInBytes)) {
    if (bucket.length && bucketBytes + file.sizeInBytes > bucketSize) {
      buckets.push(bucket);
      bucket = [];
      bucketBytes = 0;
    }
    bucket.push(file);
    bucketBytes += file.sizeInBytes;
  }
  if (bucket.length) buckets.push(bucket);

  for (const group of buckets) {
    await cloudflare(jwt, "/pages/assets/upload", {
      method: "POST",
      body: JSON.stringify(group.map((file) => ({
        key: file.hash,
        value: file.contents.toString("base64"),
        metadata: { contentType: file.contentType },
        base64: true,
      }))),
    });
  }

  try {
    await cloudflare(jwt, "/pages/assets/upsert-hashes", {
      method: "POST",
      body: JSON.stringify({ hashes: files.map((file) => file.hash) }),
    });
  } catch {
    // Non-fatal: wrangler also continues if hash bookkeeping fails.
  }

  const manifest = buildPagesManifest(files);
  await writeFile(
    resolve("private-handoff/pages-manifest.json"),
    JSON.stringify({
      accountId,
      projectName,
      fileCount: files.length,
      uploaded: toUpload.length,
      skipped: files.length - toUpload.length,
      manifest,
    }),
    "utf8",
  );

  console.log(JSON.stringify({
    fileCount: files.length,
    uploaded: toUpload.length,
    skipped: files.length - toUpload.length,
  }, null, 2));
}

if (invokedDirectly()) {
  await main();
}
