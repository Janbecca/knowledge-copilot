import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { RuntimeConfig } from "../../mcp-server/config.js";
import { startHttp, stopHttp } from "../../mcp-server/http.js";
import { service as createService } from "../helpers.js";

describe("OIDC HTTP ownership and device flow", () => {
  let jwksServer: Server; let appServer: Server; let privateKey: CryptoKey; let issuer: string; let base: string; let closeStore: () => void;

  beforeEach(async () => {
    const keys = await generateKeyPair("RS256"); privateKey = keys.privateKey;
    const jwk = await exportJWK(keys.publicKey); Object.assign(jwk, { kid: "test-key", use: "sig", alg: "RS256" });
    jwksServer = createServer((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ keys: [jwk] })); });
    await new Promise<void>(resolve => jwksServer.listen(0, "127.0.0.1", resolve));
    issuer = `http://127.0.0.1:${(jwksServer.address() as AddressInfo).port}`;
    const fixture = createService(); closeStore = () => fixture.store.close();
    const config: RuntimeConfig = {
      environment: "test", host: "127.0.0.1", port: 0, publicBaseUrl: "https://knowledge-copilot.xyz", database: ":memory:", logLevel: "error",
      bodyLimitBytes: 4096, requestTimeoutMs: 5_000, rateLimitMax: 50, rateLimitWindowMs: 60_000, corsOrigins: [],
      authMode: "oidc", oidcIssuer: issuer, oidcAudience: "https://knowledge-copilot.xyz", oidcJwksUrl: `${issuer}/jwks`,
    };
    appServer = await startHttp(fixture.service, config);
    base = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await stopHttp(appServer); await new Promise<void>((resolve, reject) => jwksServer.close(error => error ? reject(error) : resolve())); closeStore();
  });

  const token = async (subject: string, scope: string) => new SignJWT({ scope, name: subject })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" }).setSubject(subject).setIssuer(issuer).setAudience("https://knowledge-copilot.xyz").setIssuedAt().setExpirationTime("5m").sign(privateKey);
  const headers = (bearer: string) => ({ authorization: `Bearer ${bearer}`, "content-type": "application/json" });

  it("advertises OAuth, enforces scopes and ownership, and completes device wake", async () => {
    const metadata = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json() as { resource: string; authorization_servers: string[] };
    expect(metadata.resource).toBe("https://knowledge-copilot.xyz");
    expect(metadata.authorization_servers).toEqual([issuer]);
    const anonymous = await fetch(`${base}/api/sessions`, { method: "POST", body: "{}" });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("www-authenticate")).toContain("oauth-protected-resource");

    const readOnly = await token("alice", "knowledge:read");
    expect((await fetch(`${base}/api/sessions`, { method: "POST", headers: headers(readOnly), body: "{}" })).status).toBe(403);

    const alice = await token("alice", "knowledge:read knowledge:write device:manage capture:write");
    const bob = await token("bob", "knowledge:read knowledge:write device:manage capture:write");
    const sessionResponse = await fetch(`${base}/api/sessions`, { method: "POST", headers: headers(alice), body: JSON.stringify({ title: "Owned notes" }) });
    expect(sessionResponse.status).toBe(201);
    const session = await sessionResponse.json() as { session_id: string };
    expect((await fetch(`${base}/api/sessions/${session.session_id}`, { headers: headers(bob) })).status).toBe(404);

    const pairedResponse = await fetch(`${base}/api/devices/pair`, { method: "POST", headers: headers(alice), body: JSON.stringify({ name: "Windows laptop", platform: "windows" }) });
    expect(pairedResponse.status).toBe(201);
    const paired = await pairedResponse.json() as { device: { device_id: string }; device_token: string };
    const captureBody = JSON.stringify({ source_host: "chatgpt", conversation_ref: "chatgpt:conversation-1", user_message: "Question", assistant_message: "Answer", knowledge_items: [], idempotency_key: "device-turn-1" });
    expect((await fetch(`${base}/api/sessions/${session.session_id}/capture`, { method: "POST", headers: headers(paired.device_token), body: captureBody })).status).toBe(403);
    const consent = await fetch(`${base}/api/device/consents`, { method: "POST", headers: headers(paired.device_token), body: JSON.stringify({ source_host: "chatgpt", conversation_ref: "chatgpt:conversation-1", scope: "conversation-text" }) });
    expect(consent.status).toBe(201);
    expect((await fetch(`${base}/api/sessions/${session.session_id}/capture`, { method: "POST", headers: headers(paired.device_token), body: captureBody })).status).toBe(200);
    expect((await fetch(`${base}/api/device/consents/revoke`, { method: "POST", headers: headers(paired.device_token), body: JSON.stringify({ source_host: "chatgpt", conversation_ref: "chatgpt:conversation-1" }) })).status).toBe(200);
    const wakeResponse = await fetch(`${base}/api/wake-tokens`, { method: "POST", headers: headers(alice), body: JSON.stringify({ device_id: paired.device.device_id, session_id: session.session_id, source_host: "chatgpt" }) });
    const wake = await wakeResponse.json() as { wake_token: string; deep_link: string };
    expect(wake.deep_link).toContain("knowledge-copilot://wake");
    const consumed = await fetch(`${base}/api/wake-tokens/consume`, { method: "POST", headers: headers(paired.device_token), body: JSON.stringify({ wake_token: wake.wake_token }) });
    expect(consumed.status).toBe(200);
    expect(await consumed.json()).toMatchObject({ session_id: session.session_id, source_host: "chatgpt" });
    expect((await fetch(`${base}/api/wake-tokens/consume`, { method: "POST", headers: headers(paired.device_token), body: JSON.stringify({ wake_token: wake.wake_token }) })).status).toBe(400);
  });
});
