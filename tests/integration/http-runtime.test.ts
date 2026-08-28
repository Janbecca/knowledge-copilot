import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startHttp, stopHttp } from "../../mcp-server/http.js";
import type { RuntimeConfig } from "../../mcp-server/config.js";
import { service as createService } from "../helpers.js";

const open: Array<() => Promise<void>> = [];
afterEach(async () => { while (open.length) await open.pop()!(); });

async function runtime(overrides: Partial<RuntimeConfig> = {}) {
  const fixture = createService();
  const config: RuntimeConfig = {
    environment: "test", host: "127.0.0.1", port: 0, database: ":memory:", logLevel: "error",
    bodyLimitBytes: 1024, requestTimeoutMs: 5_000, rateLimitMax: 20, rateLimitWindowMs: 60_000,
    corsOrigins: ["https://allowed.test"], appsChallenge: "challenge-value", ...overrides,
  };
  const server = await startHttp(fixture.service, config);
  const address = server.address() as AddressInfo;
  const close = async () => { await stopHttp(server); fixture.store.close(); };
  open.push(close);
  return `http://127.0.0.1:${address.port}`;
}

describe("deployable HTTP runtime", () => {
  it("separates liveness, readiness, app, and challenge routes", async () => {
    const base = await runtime();
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true });
    expect(await (await fetch(`${base}/ready`)).json()).toMatchObject({ ok: true, extractor: "mock" });
    expect((await fetch(`${base}/`, { redirect: "manual" })).headers.get("location")).toBe("/app/");
    expect(await (await fetch(`${base}/.well-known/openai-apps-challenge`)).text()).toBe("challenge-value");
  });
  it("enforces exact CORS, request size, and rate limits", async () => {
    const base = await runtime({ bodyLimitBytes: 16, rateLimitMax: 1 });
    const forbidden = await fetch(`${base}/api/sessions`, { method: "POST", headers: { origin: "https://blocked.test", "content-type": "application/json" }, body: "{}" });
    expect(forbidden.status).toBe(403);
    const tooLarge = await fetch(`${base}/api/sessions`, { method: "POST", headers: { origin: "https://allowed.test", "content-type": "application/json" }, body: JSON.stringify({ title: "x".repeat(50) }) });
    expect(tooLarge.status).toBe(413);
    const limited = await fetch(`${base}/missing`);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("x-request-id")).toBeTruthy();
  });
  it("allows the standalone panel origin and supports renaming sessions", async () => {
    const base = await runtime({ publicBaseUrl: "https://panel.example.test" });
    const preflight = await fetch(`${base}/api/sessions`, { method: "OPTIONS", headers: { origin: "https://panel.example.test", "access-control-request-method": "POST" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://panel.example.test");
    const created = await (await fetch(`${base}/api/sessions`, { method: "POST", headers: { origin: "https://panel.example.test", "content-type": "application/json" }, body: JSON.stringify({ title: "Original" }) })).json() as { session_id: string };
    const renamed = await (await fetch(`${base}/api/sessions/${created.session_id}/title`, { method: "POST", headers: { origin: "https://panel.example.test", "content-type": "application/json" }, body: JSON.stringify({ title: "Renamed" }) })).json() as { title: string };
    expect(renamed.title).toBe("Renamed");
  });
});
