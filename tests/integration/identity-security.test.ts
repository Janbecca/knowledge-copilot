import { afterEach, describe, expect, it } from "vitest";
import { IdentityService } from "../../packages/identity/index.js";
import { service as createService } from "../helpers.js";

const close: Array<() => void> = [];
afterEach(() => { while (close.length) close.pop()!(); });

describe("identity, ownership, consent, and wake security", () => {
  it("isolates sessions by authenticated owner", () => {
    const fixture = createService(); close.push(() => fixture.store.close());
    const identity = new IdentityService(fixture.store);
    const alice = identity.ensureUser("oidc|alice");
    const bob = identity.ensureUser("oidc|bob");
    const session = fixture.service.start({ title: "Alice notes" }, alice.user_id);

    expect(fixture.service.get(session.session_id, alice.user_id).session.title).toBe("Alice notes");
    expect(() => fixture.service.get(session.session_id, bob.user_id)).toThrow("session not found");
    expect(() => fixture.service.get(session.session_id)).toThrow("session not found");
  });

  it("pairs a revocable device and consumes a wake token exactly once", () => {
    const fixture = createService(); close.push(() => fixture.store.close());
    const identity = new IdentityService(fixture.store);
    const user = identity.ensureUser("oidc|owner");
    const session = fixture.service.start({ title: "Wake test" }, user.user_id);
    const paired = identity.pairDevice(user.user_id, { name: "Windows laptop", platform: "windows" });
    const device = identity.authenticateDevice(paired.device_token);
    expect(device).toMatchObject({ userId: user.user_id, deviceId: paired.device.device_id, authType: "device" });

    const grant = identity.grantConsent(user.user_id, { sourceHost: "chatgpt", scope: "conversation-text", deviceId: paired.device.device_id, conversationRef: "conversation-1" });
    expect(identity.listConsents(user.user_id)).toContainEqual(grant);
    expect(identity.hasActiveConsent({ userId: user.user_id, deviceId: paired.device.device_id, sourceHost: "chatgpt", conversationRef: "conversation-1", scope: "conversation-text" })).toBe(true);
    expect(identity.hasActiveConsent({ userId: user.user_id, deviceId: paired.device.device_id, sourceHost: "chatgpt", conversationRef: "another-conversation", scope: "conversation-text" })).toBe(false);

    const wake = identity.issueWakeToken(user.user_id, { deviceId: paired.device.device_id, sessionId: session.session_id, sourceHost: "chatgpt", ttlSeconds: 60 });
    expect(wake.deep_link).toMatch(/^knowledge-copilot:\/\/wake\?token=kc_wake_/);
    expect(identity.consumeWakeToken(device!, wake.wake_token)).toEqual({ session_id: session.session_id, source_host: "chatgpt", user_id: user.user_id, extraction_mode: "host_structured" });
    expect(() => identity.consumeWakeToken(device!, wake.wake_token)).toThrow("invalid or expired");

    identity.revokeConsent(user.user_id, grant.grant_id);
    expect(identity.hasActiveConsent({ userId: user.user_id, deviceId: paired.device.device_id, sourceHost: "chatgpt", conversationRef: "conversation-1", scope: "conversation-text" })).toBe(false);
    identity.revokeDevice(user.user_id, paired.device.device_id);
    expect(identity.authenticateDevice(paired.device_token)).toBeNull();
  });

  it("does not issue a wake token for another user's device or session", () => {
    const fixture = createService(); close.push(() => fixture.store.close());
    const identity = new IdentityService(fixture.store);
    const alice = identity.ensureUser("oidc|alice"); const bob = identity.ensureUser("oidc|bob");
    const device = identity.pairDevice(alice.user_id, { name: "Alice PC", platform: "windows" }).device;
    const session = fixture.service.start({}, alice.user_id);
    expect(() => identity.issueWakeToken(bob.user_id, { deviceId: device.device_id, sessionId: session.session_id, sourceHost: "chatgpt" })).toThrow("device not found");
  });
});
