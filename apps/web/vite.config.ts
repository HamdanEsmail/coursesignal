/// <reference types="vitest/config" />
import { accessSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import {
  build as viteBuild,
  defineConfig,
  type Plugin,
  type PreviewServer,
  type ViteDevServer,
} from "vite";
import { buildIcs, LODGE_ICS_QUERY_HINT, parseEventQuery } from "./src/lib/calendar.js";

const root = fileURLToPath(new URL(".", import.meta.url));

function attachIcs(server: ViteDevServer | PreviewServer) {
  server.middlewares.use((req, res, next) => {
    const host = req.headers.host ?? "127.0.0.1";
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (url.pathname !== "/add.ics") {
      next();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    const events = parseEventQuery(url.searchParams);
    if (events.length === 0) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(LODGE_ICS_QUERY_HINT);
      return;
    }

    const body = buildIcs(events);
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="lodge.ics"');
    res.end(req.method === "HEAD" ? undefined : body);
  });
}

function lodgeIcs() {
  return {
    name: "lodge-ics",
    configureServer(server: ViteDevServer) {
      attachIcs(server);
    },
    configurePreviewServer(server: PreviewServer) {
      attachIcs(server);
    },
  };
}

function emitIcsWorker(): Plugin {
  let outDir = path.join(root, "dist");
  return {
    name: "emit-ics-worker",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async writeBundle() {
      await viteBuild({
        configFile: false,
        root,
        publicDir: false,
        logLevel: "error",
        build: {
          emptyOutDir: false,
          copyPublicDir: false,
          minify: false,
          sourcemap: false,
          outDir,
          lib: {
            entry: path.join(root, "src/ics-worker.ts"),
            formats: ["es"],
            fileName: () => "_worker.js",
          },
        },
      });
      accessSync(path.join(outDir, "_worker.js"));
    },
  };
}

export default defineConfig({
  plugins: [react(), lodgeIcs(), emitIcsWorker()],
  server: {
    host: "127.0.0.1",
    port: 4173,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
  test: {
    environment: "node",
  },
});
