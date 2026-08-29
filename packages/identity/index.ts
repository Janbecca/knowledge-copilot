import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { KnowledgeStore } from "../storage/index.js";

export type AccessScope = "knowledge:read" | "knowledge:write" | "device:manage" | "capture:write";
export interface AccessContext {
  subject: string;
  userId: string | null;
  scopes: ReadonlySet<string>;
  authType: "development" | "oidc" | "device";
  deviceId?: string;
}

export interface UserRecord { user_id: string; subject: string; display_name: string | null; email: string | null; created_at: string; updated_at: string }
export interface DeviceRecord { device_id: string; user_id: string; name: string; platform: string; created_at: string; last_seen_at: string; revoked_at: string | null }
export interface ConsentRecord { grant_id: string; user_id: string; device_id: string | null; source_host: string; conversation_ref: string | null; scope: string; created_at: string; updated_at: string; revoked_at: string | null }

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const secret = (prefix: string): string => `${prefix}_${randomBytes(32).toString("base64url")}`;

export class IdentityService {
  constructor(readonly store: KnowledgeStore) {}

  ensureUser(subject: string, profile: { displayName?: string; email?: string } = {}): UserRecord {
    const existing = this.store.db.prepare("SELECT * FROM users WHERE subject=?").get(subject) as UserRecord | undefined;
    const at = new Date().toISOString();
    if (existing) {
      this.store.db.prepare("UPDATE users SET display_name=COALESCE(?,display_name),email=COALESCE(?,email),updated_at=? WHERE user_id=?")
        .run(profile.displayName ?? null, profile.email ?? null, at, existing.user_id);
      return this.store.db.prepare("SELECT * FROM users WHERE user_id=?").get(existing.user_id) as unknown as UserRecord;
    }
    const user: UserRecord = { user_id: `user_${randomUUID()}`, subject, display_name: profile.displayName ?? null, email: profile.email ?? null, created_at: at, updated_at: at };
    this.store.db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run(user.user_id, user.subject, user.display_name, user.email, user.created_at, user.updated_at);
    this.audit(user.user_id, "user.created", user.user_id, {});
    return user;
  }

  pairDevice(userId: string, input: { name: string; platform: string }): { device: DeviceRecord; device_token: string } {
    const name = input.name.trim(); const platform = input.platform.trim();
    if (!name || name.length > 80) throw new Error("device name must be 1-80 characters");
    if (!platform || platform.length > 40) throw new Error("device platform must be 1-40 characters");
    const token = secret("kc_device"); const at = new Date().toISOString();
    const device: DeviceRecord = { device_id: `device_${randomUUID()}`, user_id: userId, name, platform, created_at: at, last_seen_at: at, revoked_at: null };
    this.store.db.prepare("INSERT INTO devices VALUES(?,?,?,?,?,?,?,?)").run(device.device_id, userId, name, platform, hash(token), at, at, null);
    this.audit(userId, "device.paired", device.device_id, { platform });
    return { device, device_token: token };
  }

  listDevices(userId: string): DeviceRecord[] {
    return this.store.db.prepare("SELECT device_id,user_id,name,platform,created_at,last_seen_at,revoked_at FROM devices WHERE user_id=? ORDER BY created_at DESC").all(userId) as unknown as DeviceRecord[];
  }

  revokeDevice(userId: string, deviceId: string): void {
    const at = new Date().toISOString();
    const result = this.store.db.prepare("UPDATE devices SET revoked_at=? WHERE device_id=? AND user_id=? AND revoked_at IS NULL").run(at, deviceId, userId);
    if (result.changes !== 1) throw new Error("device not found");
    this.store.db.prepare("UPDATE consent_grants SET revoked_at=?,updated_at=? WHERE device_id=? AND user_id=? AND revoked_at IS NULL").run(at, at, deviceId, userId);
    this.audit(userId, "device.revoked", deviceId, {});
  }

  authenticateDevice(token: string): AccessContext | null {
    const row = this.store.db.prepare("SELECT device_id,user_id FROM devices WHERE token_hash=? AND revoked_at IS NULL").get(hash(token)) as { device_id: string; user_id: string } | undefined;
    if (!row) return null;
    this.store.db.prepare("UPDATE devices SET last_seen_at=? WHERE device_id=?").run(new Date().toISOString(), row.device_id);
    return { subject: `device:${row.device_id}`, userId: row.user_id, deviceId: row.device_id, scopes: new Set(["capture:write"]), authType: "device" };
  }

  grantConsent(userId: string, input: { sourceHost: string; scope: string; deviceId?: string; conversationRef?: string }): ConsentRecord {
    if (!input.sourceHost.trim() || !input.scope.trim()) throw new Error("source host and scope are required");
    if (input.deviceId) this.requireOwnedActiveDevice(userId, input.deviceId);
    const at = new Date().toISOString();
    const grant: ConsentRecord = { grant_id: `grant_${randomUUID()}`, user_id: userId, device_id: input.deviceId ?? null, source_host: input.sourceHost.trim(), conversation_ref: input.conversationRef?.trim() || null, scope: input.scope.trim(), created_at: at, updated_at: at, revoked_at: null };
    this.store.db.prepare("INSERT INTO consent_grants VALUES(?,?,?,?,?,?,?,?,?)").run(grant.grant_id, userId, grant.device_id, grant.source_host, grant.conversation_ref, grant.scope, at, at, null);
    this.audit(userId, "consent.granted", grant.grant_id, { source_host: grant.source_host, conversation_scoped: Boolean(grant.conversation_ref) });
    return grant;
  }

  listConsents(userId: string): ConsentRecord[] {
    return this.store.db.prepare("SELECT * FROM consent_grants WHERE user_id=? ORDER BY created_at DESC").all(userId) as unknown as ConsentRecord[];
  }

  hasActiveConsent(input: { userId: string; deviceId: string; sourceHost: string; conversationRef: string; scope: string }): boolean {
    const row = this.store.db.prepare(`SELECT 1 FROM consent_grants
      WHERE user_id=? AND device_id=? AND source_host=? AND scope=? AND revoked_at IS NULL
      AND (conversation_ref=? OR conversation_ref IS NULL) LIMIT 1`)
      .get(input.userId, input.deviceId, input.sourceHost, input.scope, input.conversationRef);
    return Boolean(row);
  }

  revokeConsent(userId: string, grantId: string): void {
    const at = new Date().toISOString();
    const result = this.store.db.prepare("UPDATE consent_grants SET revoked_at=?,updated_at=? WHERE grant_id=? AND user_id=? AND revoked_at IS NULL").run(at, at, grantId, userId);
    if (result.changes !== 1) throw new Error("consent grant not found");
    this.audit(userId, "consent.revoked", grantId, {});
  }

  revokeDeviceConversationConsent(input: { userId: string; deviceId: string; sourceHost: string; conversationRef: string }): number {
    const at = new Date().toISOString();
    const result = this.store.db.prepare(`UPDATE consent_grants SET revoked_at=?,updated_at=?
      WHERE user_id=? AND device_id=? AND source_host=? AND conversation_ref=? AND revoked_at IS NULL`)
      .run(at, at, input.userId, input.deviceId, input.sourceHost, input.conversationRef);
    if (result.changes) this.audit(input.userId, "consent.revoked_by_device", input.deviceId, { source_host: input.sourceHost, conversation_ref: input.conversationRef });
    return Number(result.changes);
  }

  issueWakeToken(userId: string, input: { deviceId: string; sessionId?: string; sourceHost: string; ttlSeconds?: number }): { wake_token: string; deep_link: string; expires_at: string } {
    this.requireOwnedActiveDevice(userId, input.deviceId);
    if (input.sessionId && this.store.sessionOwner(input.sessionId) !== userId) throw new Error("session not found");
    const ttl = Math.min(300, Math.max(15, input.ttlSeconds ?? 60));
    const raw = secret("kc_wake"); const at = new Date(); const expires = new Date(at.getTime() + ttl * 1000).toISOString();
    this.store.db.prepare("INSERT INTO wake_tokens VALUES(?,?,?,?,?,?,?,?)").run(hash(raw), userId, input.deviceId, input.sessionId ?? null, input.sourceHost, expires, null, at.toISOString());
    this.audit(userId, "wake.issued", input.deviceId, { source_host: input.sourceHost, ttl_seconds: ttl });
    return { wake_token: raw, deep_link: `knowledge-copilot://wake?token=${encodeURIComponent(raw)}`, expires_at: expires };
  }

  consumeWakeToken(device: AccessContext, raw: string): { session_id: string | null; source_host: string; user_id: string; extraction_mode: string | null } {
    if (device.authType !== "device" || !device.deviceId || !device.userId) throw new Error("paired device authentication required");
    const now = new Date().toISOString();
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.store.db.prepare("SELECT w.*,s.extraction_mode FROM wake_tokens w LEFT JOIN sessions s ON s.session_id=w.session_id WHERE w.token_hash=?").get(hash(raw)) as { user_id: string; device_id: string; session_id: string | null; source_host: string; expires_at: string; consumed_at: string | null; extraction_mode: string | null } | undefined;
      if (!row || row.user_id !== device.userId || row.device_id !== device.deviceId || row.consumed_at || row.expires_at <= now) throw new Error("wake token is invalid or expired");
      this.store.db.prepare("UPDATE wake_tokens SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL").run(now, hash(raw));
      this.audit(device.userId, "wake.consumed", device.deviceId, { source_host: row.source_host });
      this.store.db.exec("COMMIT");
      return { session_id: row.session_id, source_host: row.source_host, user_id: row.user_id, extraction_mode: row.extraction_mode };
    } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
  }

  private requireOwnedActiveDevice(userId: string, deviceId: string): void {
    const found = this.store.db.prepare("SELECT 1 FROM devices WHERE device_id=? AND user_id=? AND revoked_at IS NULL").get(deviceId, userId);
    if (!found) throw new Error("device not found");
  }

  private audit(userId: string | null, eventType: string, targetId: string | null, metadata: Record<string, unknown>): void {
    this.store.db.prepare("INSERT INTO security_audit(user_id,event_type,target_id,metadata,created_at) VALUES(?,?,?,?,?)")
      .run(userId, eventType, targetId, JSON.stringify(metadata), new Date().toISOString());
  }
}
