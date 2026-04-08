import { describe, it, expect, afterEach } from "vitest";
import { HealthServer } from "../health.js";

describe("HealthServer", () => {
  let server: HealthServer;

  afterEach(async () => {
    if (server) await server.stop();
  });

  it("should return ok when all checks pass", async () => {
    server = new HealthServer();
    server.addCheck("service-a", () => true);
    server.addCheck("service-b", () => true);
    await server.start(0); // port 0 = OS picks a free port

    const status = server.getStatus();
    expect(status.status).toBe("ok");
    expect(status.checks["service-a"]).toBe(true);
    expect(status.checks["service-b"]).toBe(true);
    expect(status.uptime).toBeGreaterThanOrEqual(0);
  });

  it("should return degraded when any check fails", async () => {
    server = new HealthServer();
    server.addCheck("healthy", () => true);
    server.addCheck("unhealthy", () => false);
    await server.start(0);

    const status = server.getStatus();
    expect(status.status).toBe("degraded");
    expect(status.checks["healthy"]).toBe(true);
    expect(status.checks["unhealthy"]).toBe(false);
  });

  it("should return degraded when a check throws", async () => {
    server = new HealthServer();
    server.addCheck("broken", () => {
      throw new Error("boom");
    });
    await server.start(0);

    const status = server.getStatus();
    expect(status.status).toBe("degraded");
    expect(status.checks["broken"]).toBe(false);
  });

  it("should respond 200 on /healthz when healthy", async () => {
    server = new HealthServer();
    server.addCheck("ok", () => true);
    await server.start(0);

    const address = (server as any).server.address();
    const port = typeof address === "object" ? address.port : address;
    const res = await fetch(`http://localhost:${port}/healthz`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  it("should respond 503 on /healthz when degraded", async () => {
    server = new HealthServer();
    server.addCheck("failing", () => false);
    await server.start(0);

    const address = (server as any).server.address();
    const port = typeof address === "object" ? address.port : address;
    const res = await fetch(`http://localhost:${port}/healthz`);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("degraded");
  });

  it("should respond 404 on unknown paths", async () => {
    server = new HealthServer();
    await server.start(0);

    const address = (server as any).server.address();
    const port = typeof address === "object" ? address.port : address;
    const res = await fetch(`http://localhost:${port}/unknown`);

    expect(res.status).toBe(404);
  });

  it("should return ok with no checks registered", () => {
    server = new HealthServer();
    const status = server.getStatus();
    expect(status.status).toBe("ok");
    expect(Object.keys(status.checks)).toHaveLength(0);
  });
});
