import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { BridgeLogger } from "./types.js";

export type TransportHealth = "starting" | "connecting" | "connected" | "reconnecting" | "stopping";

export type HealthSnapshot = {
  service: "coursesignal-bridge";
  status: "ok" | "degraded" | "stopping";
  transport: TransportHealth;
  acceptingMessages: boolean;
  uptimeSeconds: number;
};

export class BridgeHealthState {
  readonly #startedAt: number;
  #transport: TransportHealth = "starting";

  constructor(startedAt = Date.now()) {
    this.#startedAt = startedAt;
  }

  setTransport(transport: TransportHealth): void {
    this.#transport = transport;
  }

  snapshot(now = Date.now()): HealthSnapshot {
    return {
      service: "coursesignal-bridge",
      status: this.#transport === "connected"
        ? "ok"
        : this.#transport === "stopping" ? "stopping" : "degraded",
      transport: this.#transport,
      acceptingMessages: this.#transport === "connected",
      uptimeSeconds: Math.max(0, Math.floor((now - this.#startedAt) / 1_000)),
    };
  }
}

export type HealthServer = {
  host: string;
  port: number;
  stop(): Promise<void>;
};

export function configuredHealthPort(
  environment: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const raw = environment.COURSESIGNAL_HEALTH_PORT?.trim() || environment.PORT?.trim();
  if (!raw) return undefined;
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("COURSESIGNAL_HEALTH_PORT/PORT must be an integer from 1 to 65535.");
  }
  return port;
}

export async function startHealthServer(options: {
  state: BridgeHealthState;
  logger: BridgeLogger;
  port: number;
  host?: string;
}): Promise<HealthServer> {
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65_535) {
    throw new Error("Health server port must be an integer from 0 to 65535.");
  }
  const host = options.host?.trim() || "0.0.0.0";
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const pathname = safePathname(request.url);

    if (pathname !== "/healthz") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Method not allowed\n");
      return;
    }

    const body = `${JSON.stringify(options.state.snapshot())}\n`;
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
    });
    response.end(request.method === "HEAD" ? undefined : body);
  });
  server.requestTimeout = 5_000;
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  server.maxHeadersCount = 32;
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  await listen(server, options.port, host);
  const address = server.address() as AddressInfo;
  options.logger.info("health.started", { port: address.port });
  let stopped = false;

  return {
    host,
    port: address.port,
    async stop() {
      if (stopped) return;
      stopped = true;
      await close(server);
      options.logger.info("health.stopped");
    },
  };
}

export async function startOptionalHealthServer(options: {
  state: BridgeHealthState;
  logger: BridgeLogger;
  environment?: NodeJS.ProcessEnv;
}): Promise<HealthServer | undefined> {
  const environment = options.environment ?? process.env;
  const port = configuredHealthPort(environment);
  if (port === undefined) return undefined;
  return startHealthServer({
    state: options.state,
    logger: options.logger,
    port,
    host: environment.COURSESIGNAL_HEALTH_HOST,
  });
}

function safePathname(rawUrl: string | undefined): string {
  try {
    return new URL(rawUrl || "/", "http://health.invalid").pathname;
  } catch {
    return "/invalid";
  }
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
