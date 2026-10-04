/// <reference types="vitest/config" />
import { defineConfig, type PreviewServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { buildIcs, LODGE_ICS_QUERY_HINT, parseEventQuery } from "./src/lib/calendar.js";

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

export default defineConfig({
  plugins: [react(), lodgeIcs()],
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
