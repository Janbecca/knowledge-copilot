import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { KnowledgeService } from "../packages/knowledge-engine/service.js";
import { IdentityService, type AccessContext } from "../packages/identity/index.js";
import type { RuntimeConfig } from "./config.js";
import { createMcpServer } from "./server.js";
import { AuthenticationError, RequestAuthenticator, requireScope, requireUser } from "./auth.js";

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const shutdownHandlers = new WeakMap<Server, () => Promise<void>>();

async function body(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk); length += buffer.length;
    if (length > limit) throw new HttpError(413, "request body too large");
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(400, "invalid JSON body"); }
}

function responseHeaders(req: IncomingMessage, config: RuntimeConfig): Record<string, string> {
  const headers: Record<string, string> = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cache-control": "no-store" };
  const origin = req.headers.origin;
  if (origin && allowedOrigin(origin, config)) { headers["access-control-allow-origin"] = origin; headers.vary = "Origin"; }
  return headers;
}
function allowedOrigin(origin: string, config: RuntimeConfig): boolean {
  if (config.corsOrigins.includes(origin)) return true;
  if (!config.publicBaseUrl) return false;
  try { return new URL(config.publicBaseUrl).origin === origin; } catch { return false; }
}
function json(req: IncomingMessage, res: ServerResponse, config: RuntimeConfig, status: number, data: unknown): void {
  res.writeHead(status, { ...responseHeaders(req, config), "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(data));
}
function escaped(value: string): string { return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!); }
function installGuide(config: RuntimeConfig): string {
  const installer = config.desktopInstallerUrl;
  const download = installer
    ? `<a class="primary" href="${escaped(installer)}">下载 Windows 安装包</a>`
    : `<button class="primary" disabled>安装包正在准备签名发布</button><p class="muted">开发版可在项目中运行 <code>npm run desktop:build</code> 生成 NSIS 安装包。</p>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>安装 Knowledge Copilot</title><style>body{margin:0;background:#eef4ef;color:#173b2b;font:15px/1.6 Inter,"Microsoft YaHei",sans-serif}.wrap{max-width:680px;margin:8vh auto;padding:36px;background:white;border:1px solid #d5e1d9;border-radius:24px;box-shadow:0 18px 60px #173b2b20}h1{margin:0 0 8px;font-size:30px}.lead{color:#536a5e}.actions{display:flex;gap:12px;flex-wrap:wrap;margin:26px 0}.primary,.secondary{display:inline-block;border:0;border-radius:12px;padding:12px 18px;text-decoration:none;cursor:pointer}.primary{background:#1f6646;color:white}.primary:disabled{opacity:.55}.secondary{background:#e6efe9;color:#214c37}ol{padding-left:22px}.muted{color:#718078;font-size:13px}.status{min-height:24px;color:#8a5b15}code{background:#edf2ee;padding:2px 5px;border-radius:5px}</style></head><body><main class="wrap"><p>KNOWLEDGE COPILOT DESKTOP</p><h1>让知识驾驶舱悬浮在桌面</h1><p class="lead">安装后，ChatGPT、Claude Code、Codex 或 WorkBuddy 的受支持适配器可以唤醒同一个悬浮窗。安装本身不会授权读取任何对话。</p><div class="actions"><button id="open" class="secondary">我已安装，打开应用</button>${download}</div><p id="status" class="status"></p><ol><li>安装并首次启动桌面端。</li><li>在账号安全页创建并配对这台设备。</li><li>回到 AI 对话中调用 Knowledge Copilot；每个宿主或对话仍需单独授权。</li></ol><p class="muted">安全边界：不监听全局键盘、剪贴板或屏幕；唤醒链接使用短时一次性令牌。</p></main><script>document.getElementById('open').onclick=()=>{document.getElementById('status').textContent='正在请求 Windows 打开 Knowledge Copilot…';location.href='knowledge-copilot://open';setTimeout(()=>{document.getElementById('status').textContent='如果没有弹出应用，请先下载安装。浏览器可能会要求确认打开外部应用。'},1600)}</script></body></html>`;
}

export async function startHttp(service: KnowledgeService, config: RuntimeConfig): Promise<Server> {
  const identity = new IdentityService(service.store); const authenticator = new RequestAuthenticator(config, identity);
  const transports = new Map<string, { transport: StreamableHTTPServerTransport; access: AccessContext }>();
  const rateWindows = new Map<string, { resetAt: number; count: number }>();
  const server = createServer(async (req, res) => {
    const requestId = randomUUID(); res.setHeader("x-request-id", requestId);
    try {
      const url = new URL(req.url ?? "/", config.publicBaseUrl ?? `http://${config.host}:${config.port}`);
      const origin = req.headers.origin;
      if (origin && !allowedOrigin(origin, config)) throw new HttpError(403, "origin not allowed");
      if (req.method === "OPTIONS") {
        res.writeHead(204, { ...responseHeaders(req, config), "access-control-allow-methods": "GET,POST,DELETE,OPTIONS", "access-control-allow-headers": "authorization,content-type,mcp-session-id,mcp-protocol-version" }); res.end(); return;
      }
      if (url.pathname === "/health") { json(req, res, config, 200, { ok: true }); return; }
      if (url.pathname === "/ready") { const ready = service.store.isReady(); json(req, res, config, ready ? 200 : 503, { ok: ready, extractor: service.extractor.name }); return; }
      if (url.pathname === "/install" || url.pathname === "/install/") { res.writeHead(200, { ...responseHeaders(req, config), "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; navigate-to 'self' knowledge-copilot: https:" }); res.end(installGuide(config)); return; }
      if (url.pathname === "/.well-known/openai-apps-challenge") {
        if (!config.appsChallenge) throw new HttpError(404, "challenge not configured");
        res.writeHead(200, { ...responseHeaders(req, config), "content-type": "text/plain; charset=utf-8" }); res.end(config.appsChallenge); return;
      }
      if (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/mcp") {
        if (config.authMode !== "oidc" || !config.oidcIssuer) throw new HttpError(404, "OAuth is not configured");
        json(req, res, config, 200, { resource: config.oidcAudience ?? `${config.publicBaseUrl ?? `http://${config.host}:${config.port}`}/mcp`, authorization_servers: [config.oidcIssuer], scopes_supported: ["knowledge:read", "knowledge:write", "device:manage", "capture:write"], bearer_methods_supported: ["header"] }); return;
      }
      if (url.pathname === "/api/auth/config" && req.method === "GET") {
        json(req, res, config, 200, config.authMode === "oidc" && config.oidcIssuer && config.oidcClientId
          ? { enabled: true, authority: config.oidcIssuer, client_id: config.oidcClientId, audience: config.oidcAudience, scope: "openid profile email knowledge:read knowledge:write device:manage capture:write" }
          : { enabled: false }); return;
      }

      const client = req.socket.remoteAddress ?? "unknown"; const now = Date.now(); const current = rateWindows.get(client);
      const window = !current || current.resetAt <= now ? { resetAt: now + config.rateLimitWindowMs, count: 0 } : current;
      window.count += 1; rateWindows.set(client, window);
      res.setHeader("ratelimit-limit", String(config.rateLimitMax)); res.setHeader("ratelimit-remaining", String(Math.max(0, config.rateLimitMax - window.count)));
      if (window.count > config.rateLimitMax) throw new HttpError(429, "rate limit exceeded");

      if (url.pathname === "/mcp") {
        const access = await authenticator.authenticate(req);
        const sessionId = req.headers["mcp-session-id"] as string | undefined; let binding = sessionId ? transports.get(sessionId) : undefined;
        if (binding && binding.access.subject !== access.subject) throw new AuthenticationError(403, "MCP session belongs to another subject");
        const payload = req.method === "POST" ? await body(req, config.bodyLimitBytes) : undefined;
        if (!binding && req.method === "POST" && isInitializeRequest(payload)) {
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: id => { transports.set(id, { transport, access }); }, onsessionclosed: id => { transports.delete(id); } });
          binding = { transport, access };
          await createMcpServer(service, access).connect(transport);
        }
        if (!binding) throw new HttpError(400, "missing or invalid MCP session");
        await binding.transport.handleRequest(req, res, payload); return;
      }
      if (url.pathname.startsWith("/api/")) {
        const access = await authenticator.authenticate(req); const owner = access.userId;
        if (url.pathname === "/api/account" && req.method === "GET") { requireScope(access, "knowledge:read"); json(req, res, config, 200, { subject: access.subject, user_id: owner, auth_type: access.authType, scopes: [...access.scopes] }); return; }
        if (url.pathname === "/api/devices" && req.method === "GET") { requireScope(access, "device:manage"); json(req, res, config, 200, { devices: identity.listDevices(requireUser(access)) }); return; }
        if (url.pathname === "/api/devices/pair" && req.method === "POST") { requireScope(access, "device:manage"); json(req, res, config, 201, identity.pairDevice(requireUser(access), await body(req, config.bodyLimitBytes) as never)); return; }
        const device = url.pathname.match(/^\/api\/devices\/([^/]+)$/); if (device && req.method === "DELETE") { requireScope(access, "device:manage"); identity.revokeDevice(requireUser(access), device[1]!); json(req, res, config, 200, { revoked: true }); return; }
        if (url.pathname === "/api/consents" && req.method === "GET") { requireScope(access, "device:manage"); json(req, res, config, 200, { consents: identity.listConsents(requireUser(access)) }); return; }
        if (url.pathname === "/api/consents" && req.method === "POST") { requireScope(access, "device:manage"); const input = await body(req, config.bodyLimitBytes) as { source_host: string; scope: string; device_id?: string; conversation_ref?: string }; json(req, res, config, 201, identity.grantConsent(requireUser(access), { sourceHost: input.source_host, scope: input.scope, deviceId: input.device_id, conversationRef: input.conversation_ref })); return; }
        const consent = url.pathname.match(/^\/api\/consents\/([^/]+)$/); if (consent && req.method === "DELETE") { requireScope(access, "device:manage"); identity.revokeConsent(requireUser(access), consent[1]!); json(req, res, config, 200, { revoked: true }); return; }
        if (url.pathname === "/api/wake-tokens" && req.method === "POST") { requireScope(access, "device:manage"); const input = await body(req, config.bodyLimitBytes) as { device_id: string; session_id?: string; source_host: string; ttl_seconds?: number }; json(req, res, config, 201, identity.issueWakeToken(requireUser(access), { deviceId: input.device_id, sessionId: input.session_id, sourceHost: input.source_host, ttlSeconds: input.ttl_seconds })); return; }
        if (url.pathname === "/api/wake-tokens/consume" && req.method === "POST") { requireScope(access, "capture:write"); const input = await body(req, config.bodyLimitBytes) as { wake_token: string }; json(req, res, config, 200, identity.consumeWakeToken(access, input.wake_token)); return; }
        if (url.pathname === "/api/device/consents" && req.method === "POST") {
          requireScope(access, "capture:write"); if (access.authType !== "device" || !access.userId || !access.deviceId) throw new AuthenticationError(403, "paired device authentication required");
          const input = await body(req, config.bodyLimitBytes) as { source_host: string; conversation_ref: string; scope: string };
          if (input.scope !== "conversation-text" || !input.conversation_ref) throw new HttpError(400, "narrow conversation-text consent is required");
          json(req, res, config, 201, identity.grantConsent(access.userId, { sourceHost: input.source_host, conversationRef: input.conversation_ref, scope: input.scope, deviceId: access.deviceId })); return;
        }
        if (url.pathname === "/api/device/consents/revoke" && req.method === "POST") {
          requireScope(access, "capture:write"); if (access.authType !== "device" || !access.userId || !access.deviceId) throw new AuthenticationError(403, "paired device authentication required");
          const input = await body(req, config.bodyLimitBytes) as { source_host: string; conversation_ref: string };
          json(req, res, config, 200, { revoked: identity.revokeDeviceConversationConsent({ userId: access.userId, deviceId: access.deviceId, sourceHost: input.source_host, conversationRef: input.conversation_ref }) > 0 }); return;
        }
        const sessionWake = url.pathname.match(/^\/api\/sessions\/([^/]+)\/wake$/); if (sessionWake && req.method === "POST") {
          requireScope(access, "knowledge:read"); requireScope(access, "device:manage"); const userId = requireUser(access); service.get(sessionWake[1]!, userId);
          const input = await body(req, config.bodyLimitBytes) as { source_host?: string; device_id?: string };
          const active = identity.listDevices(userId).find(item => !item.revoked_at && (!input.device_id || item.device_id === input.device_id));
          if (!active) { json(req, res, config, 200, { status: "not_paired", install_url: `${config.publicBaseUrl ?? ""}/install/` }); return; }
          const wake = identity.issueWakeToken(userId, { deviceId: active.device_id, sessionId: sessionWake[1]!, sourceHost: input.source_host ?? "web" });
          json(req, res, config, 200, { status: "ready", deep_link: wake.deep_link, expires_at: wake.expires_at, install_url: `${config.publicBaseUrl ?? ""}/install/` }); return;
        }
        if (url.pathname === "/api/sessions" && req.method === "POST") { requireScope(access, "knowledge:write"); json(req, res, config, 201, service.start(await body(req, config.bodyLimitBytes) as never, owner)); return; }
        const sm = url.pathname.match(/^\/api\/sessions\/([^/]+)$/); if (sm && req.method === "GET") { requireScope(access, "knowledge:read"); json(req, res, config, 200, service.get(sm[1]!, owner)); return; }
        const title = url.pathname.match(/^\/api\/sessions\/([^/]+)\/title$/); if (title && req.method === "POST") { requireScope(access, "knowledge:write"); json(req, res, config, 200, service.renameSession({ ...(await body(req, config.bodyLimitBytes) as object), session_id: title[1]! } as never, owner)); return; }
        const cards = url.pathname.match(/^\/api\/sessions\/([^/]+)\/cards$/); if (cards && req.method === "GET") { requireScope(access, "knowledge:read"); const since = url.searchParams.get("since_cursor"); json(req, res, config, 200, { cursor: service.get(cards[1]!, owner).cursor, cards: service.store.listCards(cards[1]!, { sinceCursor: since === null ? undefined : Number(since), includeInactive: url.searchParams.get("include_inactive") === "true", type: url.searchParams.get("type") ?? undefined }) }); return; }
        const cap = url.pathname.match(/^\/api\/sessions\/([^/]+)\/capture$/); if (cap && req.method === "POST") {
          requireScope(access, "capture:write"); const input = await body(req, config.bodyLimitBytes) as Record<string, unknown>;
          if (access.authType === "device") {
            const sourceHost = typeof input.source_host === "string" ? input.source_host : "";
            const conversationRef = typeof input.conversation_ref === "string" ? input.conversation_ref : "";
            if (!access.userId || !access.deviceId || !sourceHost || !conversationRef || !identity.hasActiveConsent({ userId: access.userId, deviceId: access.deviceId, sourceHost, conversationRef, scope: "conversation-text" })) throw new AuthenticationError(403, "active per-conversation capture consent required");
          }
          json(req, res, config, 200, await service.capture({ ...input, session_id: cap[1]! } as never, owner)); return;
        }
        const stat = url.pathname.match(/^\/api\/sessions\/([^/]+)\/status$/); if (stat && req.method === "POST") { requireScope(access, "knowledge:write"); json(req, res, config, 200, service.changeStatus({ ...(await body(req, config.bodyLimitBytes) as object), session_id: stat[1]! } as never, owner)); return; }
        const extractionMode = url.pathname.match(/^\/api\/sessions\/([^/]+)\/extraction-mode$/); if (extractionMode && req.method === "POST") { requireScope(access, "knowledge:write"); json(req, res, config, 200, service.changeExtractionMode({ ...(await body(req, config.bodyLimitBytes) as object), session_id: extractionMode[1]! } as never, owner)); return; }
        const exp = url.pathname.match(/^\/api\/sessions\/([^/]+)\/export\/(markdown|mermaid|json)$/); if (exp && req.method === "GET") { requireScope(access, "knowledge:read"); json(req, res, config, 200, service.export(exp[1]!, exp[2] as never, owner)); return; }
        const cstat = url.pathname.match(/^\/api\/cards\/([^/]+)\/status$/); if (cstat && req.method === "POST") { requireScope(access, "knowledge:write"); json(req, res, config, 200, service.changeLearningStatus({ card_id: cstat[1]!, ...(await body(req, config.bodyLimitBytes) as object) } as never, owner)); return; }
      }
      if (url.pathname === "/") { res.writeHead(307, { ...responseHeaders(req, config), location: "/app/" }); res.end(); return; }
      if (url.pathname === "/app" || url.pathname === "/app/" || url.pathname.startsWith("/app/assets/")) {
        const relativePath = url.pathname === "/app" || url.pathname === "/app/" ? "index.html" : url.pathname.slice(5);
        const root = resolve("apps/knowledge-panel/dist"); const path = resolve(join(root, relativePath));
        if (!(path === root || path.startsWith(`${root}\\`) || path.startsWith(`${root}/`))) throw new HttpError(404, "not found");
        const data = await readFile(path); const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };
        res.writeHead(200, { ...responseHeaders(req, config), "content-type": mime[extname(path)] ?? "application/octet-stream" }); res.end(data); return;
      }
      throw new HttpError(404, "not found");
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      const status = error instanceof HttpError || error instanceof AuthenticationError ? error.status : message.includes("not found") ? 404 : message.includes("required") || message.includes("must be") || message.includes("invalid or expired") ? 400 : 500;
      if (status === 401 && config.publicBaseUrl) res.setHeader("www-authenticate", `Bearer resource_metadata=\"${config.publicBaseUrl}/.well-known/oauth-protected-resource\"`);
      json(req, res, config, status, { error: message, request_id: requestId });
    }
  });
  server.requestTimeout = config.requestTimeoutMs; server.headersTimeout = Math.min(config.requestTimeoutMs, 60_000); server.keepAliveTimeout = 5_000;
  shutdownHandlers.set(server, async () => {
    const closed = new Promise<void>((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()));
    await Promise.allSettled([...transports.values()].map(binding => binding.transport.close())); transports.clear(); server.closeIdleConnections(); await closed;
  });
  return new Promise((resolvePromise, reject) => { server.once("error", reject); server.listen(config.port, config.host, () => { server.off("error", reject); resolvePromise(server); }); });
}

export async function stopHttp(server: Server): Promise<void> {
  const shutdown = shutdownHandlers.get(server);
  if (shutdown) { shutdownHandlers.delete(server); await shutdown(); return; }
  await new Promise<void>((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()));
}
