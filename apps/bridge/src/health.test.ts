import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BridgeHealthState,
  configuredHealthPort,
  startHealthServer,
  type HealthServer,
} from "./health.js";
import { silentLogger } from "./logger.js";

const servers: HealthServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe("configuredHealthPort", () => {
  it("is optional and prefers the explicit bridge port", () => {
    expect(configuredHealthPort({})).toBeUndefined();
    expect(configuredHealthPort({ PORT: "8080" })).toBe(8080);
    expect(configuredHealthPort({
      PORT: "8080",
      COURSESIGNAL_HEALTH_PORT: "8787",
    })).toBe(8787);
  });

  it.each(["0", "65536", "12.5", "not-a-port"])("rejects invalid port %s", (port) => {
    expect(() => configuredHealthPort({ COURSESIGNAL_HEALTH_PORT: port })).toThrow(/integer/);
  });
});

describe("BridgeHealthState", () => {
  it("reports only coarse operational state", () => {
    const state = new BridgeHealthState(1_000);
    expect(state.snapshot(3_500)).toEqual({
      service: "coursesignal-bridge",
      status: "degraded",
      transport: "starting",
      acceptingMessages: false,
      uptimeSeconds: 2,
    });
    state.setTransport("connected");
    expect(state.snapshot(4_000)).toMatchObject({ status: "ok", acceptingMessages: true });
    state.setTransport("stopping");
    expect(state.snapshot(4_000)).toMatchObject({ status: "stopping", acceptingMessages: false });
  });
});

describe("health HTTP server", () => {
  async function running(state = new BridgeHealthState()): Promise<HealthServer> {
    const server = await startHealthServer({
      state,
      logger: silentLogger,
      host: "127.0.0.1",
      port: 0,
    });
    servers.push(server);
    return server;
  }

  it("serves only a secret-free GET /healthz response", async () => {
    const state = new BridgeHealthState();
    state.setTransport("connected");
    const server = await running(state);
    const response = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual(expect.objectContaining({
      service: "coursesignal-bridge",
      status: "ok",
      transport: "connected",
      acceptingMessages: true,
    }));
    expect(Object.keys(body).sort()).toEqual([
      "acceptingMessages",
      "service",
      "status",
      "transport",
      "uptimeSeconds",
    ]);
  });

  it("supports HEAD without a response body", async () => {
    const server = await running();
    const response = await fetch(`http://127.0.0.1:${server.port}/healthz`, { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("rejects every other path and method", async () => {
    const server = await running();
    const missing = await fetch(`http://127.0.0.1:${server.port}/metrics`);
    const post = await fetch(`http://127.0.0.1:${server.port}/healthz`, { method: "POST" });
    expect(missing.status).toBe(404);
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
  });

  it("stops idempotently", async () => {
    const server = await running();
    await server.stop();
    await expect(server.stop()).resolves.toBeUndefined();
    servers.splice(servers.indexOf(server), 1);
  });

  it("emits no request access logs", async () => {
    const info = vi.fn();
    const logger = { ...silentLogger, info };
    const server = await startHealthServer({
      state: new BridgeHealthState(),
      logger,
      host: "127.0.0.1",
      port: 0,
    });
    servers.push(server);
    await fetch(`http://127.0.0.1:${server.port}/healthz?ignored=value`);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("health.started", { port: server.port });
  });
});
