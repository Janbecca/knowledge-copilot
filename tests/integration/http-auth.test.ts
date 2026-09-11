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
      bodyLimitBytes: 4096, requestTimeoutMs: 5_000, rateLimitMax: 120, rateLimitWindowMs: 60_000, corsOrigins: [],
      authMode: "oidc", oidcIssuer: issuer, oidcAudience: "https://knowledge-copilot.xyz", oidcJwksUrl: `${issuer}/jwks`,
      oidcClientId: "panel-client", oidcDesktopClientId: "desktop-client",
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
    const panelAuth = await (await fetch(`${base}/api/auth/config`)).json() as { client_id: string };
    const desktopAuth = await (await fetch(`${base}/api/auth/config?client=desktop`)).json() as { client_id: string };
    expect(panelAuth.client_id).toBe("panel-client");
    expect(desktopAuth.client_id).toBe("desktop-client");
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
    expect((await fetch(`${base}/api/sessions/${session.session_id}`, { headers: headers(paired.device_token) })).status).toBe(200);
    const captureBody = JSON.stringify({ source_host: "chatgpt", conversation_ref: "chatgpt:conversation-1", user_message: "Question", assistant_message: "Answer", knowledge_items: [], idempotency_key: "device-turn-1" });
    expect((await fetch(`${base}/api/sessions/${session.session_id}/capture`, { method: "POST", headers: headers(paired.device_token), body: captureBody })).status).toBe(403);
    const consent = await fetch(`${base}/api/device/consents`, { method: "POST", headers: headers(paired.device_token), body: JSON.stringify({ source_host: "chatgpt", conversation_ref: "chatgpt:conversation-1", scope: "conversation-text" }) });
    expect(consent.status).toBe(201);
    expect((await fetch(`${base}/api/sessions/${session.session_id}/capture`, { method: "POST", headers: headers(paired.device_token), body: captureBody })).status).toBe(200);
    const resolveAResponse = await fetch(`${base}/api/conversation-bindings/resolve`, { method: "POST", headers: headers(paired.device_token), body: JSON.stringify({ source_host: "chatgpt", conversation_ref: "chatgpt:conversation-1", create: true, title: "Conversation A" }) });
    expect(resolveAResponse.status).toBe(200);
    const resolveA = await resolveAResponse.json() as { binding: { session_id: string; capture_status: string } };
    expect(resolveA.binding.capture_status).toBe("active");
    expect(resolveA.binding.session_id).not.toBe(session.session_id);

    await fetch(`${base}/api/device/consents`, { method: "POST", headers: headers(paired.device_token), body: JSON.stringify({ source_host: "chatgpt", conversation_ref: "chatgpt:conversation-2", scope: "conversation-text" }) });
    const resolveB = await (await fetch(`${base}/api/conversation-bindings/resolve`, { method: "POST", headers: headers(paired.device_token), body: JSON.stringify({ source_host: "chatgpt", conversation_ref: "chatgpt:conversation-2", create: true, title: "Conversation B" }) })).json() as { binding: { session_id: string } };
    expect(resolveB.binding.session_id).not.toBe(resolveA.binding.session_id);
    const restoreA = await (await fetch(`${base}/api/conversation-bindings/resolve`, { method: "POST", headers: headers(paired.device_token), body: JSON.stringify({ source_host: "chatgpt", conversation_ref: "chatgpt:conversation-1", create: false }) })).json() as { binding: { session_id: string } };
    expect(restoreA.binding.session_id).toBe(resolveA.binding.session_id);

    const boundCapture = { source_host: "chatgpt", conversation_ref: "chatgpt:conversation-1", user_message: "Bound question", assistant_message: "Bound answer", idempotency_key: "bound-turn-a" };
    expect((await fetch(`${base}/api/conversation-bindings/capture`, { method: "POST", headers: headers(paired.device_token), body: JSON.stringify(boundCapture) })).status).toBe(200);
    expect((await fetch(`${base}/api/conversation-bindings/status`, { method: "POST", headers: headers(paired.device_token), body: JSON.stringify({ source_host: "chatgpt", conversation_ref: "chatgpt:conversation-1", status: "paused" }) })).status).toBe(200);
    expect((await fetch(`${base}/api/conversation-bindings/capture`, { method: "POST", headers: headers(paired.device_token), body: JSON.stringify({ ...boundCapture, idempotency_key: "bound-turn-paused" }) })).status).toBe(403);
    expect((await fetch(`${base}/api/device/consents/revoke`, { method: "POST", headers: headers(paired.device_token), body: JSON.stringify({ source_host: "chatgpt", conversation_ref: "chatgpt:conversation-1" }) })).status).toBe(200);
    const wakeResponse = await fetch(`${base}/api/wake-tokens`, { method: "POST", headers: headers(alice), body: JSON.stringify({ device_id: paired.device.device_id, session_id: session.session_id, source_host: "chatgpt" }) });
    const wake = await wakeResponse.json() as { wake_token: string; deep_link: string };
    expect(wake.deep_link).toContain("knowledge-copilot://wake");
    const consumed = await fetch(`${base}/api/wake-tokens/consume`, { method: "POST", headers: headers(paired.device_token), body: JSON.stringify({ wake_token: wake.wake_token }) });
    expect(consumed.status).toBe(200);
    expect(await consumed.json()).toMatchObject({ session_id: session.session_id, source_host: "chatgpt" });
    expect((await fetch(`${base}/api/wake-tokens/consume`, { method: "POST", headers: headers(paired.device_token), body: JSON.stringify({ wake_token: wake.wake_token }) })).status).toBe(400);
  });

  it("keeps ten alternating turns in each of three ChatGPT conversation bindings", async () => {
    const alice = await token("acceptance-alice", "knowledge:read knowledge:write device:manage capture:write");
    const pairedResponse = await fetch(`${base}/api/devices/pair`, {
      method: "POST", headers: headers(alice), body: JSON.stringify({ name: "Acceptance desktop", platform: "windows" }),
    });
    const paired = await pairedResponse.json() as { device_token: string };
    const conversations = ["chatgpt:acceptance-a", "chatgpt:acceptance-b", "chatgpt:acceptance-c"];
    const sessions = new Map<string, string>();

    for (const conversationRef of conversations) {
      expect((await fetch(`${base}/api/device/consents`, {
        method: "POST", headers: headers(paired.device_token),
        body: JSON.stringify({ source_host: "chatgpt", conversation_ref: conversationRef, scope: "conversation-text" }),
      })).status).toBe(201);
      const resolved = await (await fetch(`${base}/api/conversation-bindings/resolve`, {
        method: "POST", headers: headers(paired.device_token),
        body: JSON.stringify({ source_host: "chatgpt", conversation_ref: conversationRef, create: true, title: conversationRef }),
      })).json() as { binding: { session_id: string } };
      sessions.set(conversationRef, resolved.binding.session_id);
    }
    expect(new Set(sessions.values()).size).toBe(3);

    for (let turn = 0; turn < 10; turn += 1) {
      for (const conversationRef of conversations) {
        const capture = await fetch(`${base}/api/conversation-bindings/capture`, {
          method: "POST", headers: headers(paired.device_token),
          body: JSON.stringify({
            source_host: "chatgpt", conversation_ref: conversationRef,
            user_message: `${conversationRef} question ${turn}: Excel analysis`,
            assistant_message: `${conversationRef} answer ${turn}: define the metric before selecting a tool`,
            idempotency_key: `${conversationRef}:turn-${turn}`,
          }),
        });
        expect(capture.status).toBe(200);
        await fetch(`${base}/api/conversation-bindings/presence`, {
          method: "POST", headers: headers(paired.device_token),
          body: JSON.stringify({ source_host: "chatgpt", conversation_ref: conversationRef, status: "foreground" }),
        });
      }
    }

    const replay = await (await fetch(`${base}/api/conversation-bindings/capture`, {
      method: "POST", headers: headers(paired.device_token),
      body: JSON.stringify({
        source_host: "chatgpt", conversation_ref: conversations[0],
        user_message: `${conversations[0]} question 0: Excel analysis`,
        assistant_message: `${conversations[0]} answer 0: define the metric before selecting a tool`,
        idempotency_key: `${conversations[0]}:turn-0`,
      }),
    })).json() as { idempotent_replay: boolean };
    expect(replay.idempotent_replay).toBe(true);

    for (const [conversationRef, sessionId] of sessions) {
      const stateResponse = await fetch(`${base}/api/sessions/${sessionId}`, { headers: headers(paired.device_token) });
      expect(stateResponse.status).toBe(200);
      const state = await stateResponse.json() as { cursor: number; session: { session_id: string; title: string } };
      expect(state.cursor).toBe(10);
      expect(state.session).toMatchObject({ session_id: sessionId, title: conversationRef });
    }
  });
});
