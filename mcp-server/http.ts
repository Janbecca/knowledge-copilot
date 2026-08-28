import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { KnowledgeService } from "../packages/knowledge-engine/service.js";
import type { RuntimeConfig } from "./config.js";
import { createMcpServer } from "./server.js";

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

export async function startHttp(service: KnowledgeService, config: RuntimeConfig): Promise<Server> {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const rateWindows = new Map<string, { resetAt: number; count: number }>();
  const server = createServer(async (req, res) => {
    const requestId = randomUUID(); res.setHeader("x-request-id", requestId);
    try {
      const url = new URL(req.url ?? "/", config.publicBaseUrl ?? `http://${config.host}:${config.port}`);
      const origin = req.headers.origin;
      if (origin && !allowedOrigin(origin, config)) throw new HttpError(403, "origin not allowed");
      if (req.method === "OPTIONS") {
        res.writeHead(204, { ...responseHeaders(req, config), "access-control-allow-methods": "GET,POST,DELETE,OPTIONS", "access-control-allow-headers": "content-type,mcp-session-id,mcp-protocol-version" }); res.end(); return;
      }
      if (url.pathname === "/health") { json(req, res, config, 200, { ok: true }); return; }
      if (url.pathname === "/ready") { const ready = service.store.isReady(); json(req, res, config, ready ? 200 : 503, { ok: ready, extractor: service.extractor.name }); return; }
      if (url.pathname === "/.well-known/openai-apps-challenge") {
        if (!config.appsChallenge) throw new HttpError(404, "challenge not configured");
        res.writeHead(200, { ...responseHeaders(req, config), "content-type": "text/plain; charset=utf-8" }); res.end(config.appsChallenge); return;
      }

      const client = req.socket.remoteAddress ?? "unknown"; const now = Date.now(); const current = rateWindows.get(client);
      const window = !current || current.resetAt <= now ? { resetAt: now + config.rateLimitWindowMs, count: 0 } : current;
      window.count += 1; rateWindows.set(client, window);
      res.setHeader("ratelimit-limit", String(config.rateLimitMax)); res.setHeader("ratelimit-remaining", String(Math.max(0, config.rateLimitMax - window.count)));
      if (window.count > config.rateLimitMax) throw new HttpError(429, "rate limit exceeded");

      if (url.pathname === "/mcp") {
        const sessionId = req.headers["mcp-session-id"] as string | undefined; let transport = sessionId ? transports.get(sessionId) : undefined;
        const payload = req.method === "POST" ? await body(req, config.bodyLimitBytes) : undefined;
        if (!transport && req.method === "POST" && isInitializeRequest(payload)) {
          transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: id => { transports.set(id, transport!); }, onsessionclosed: id => { transports.delete(id); } });
          await createMcpServer(service).connect(transport);
        }
        if (!transport) throw new HttpError(400, "missing or invalid MCP session");
        await transport.handleRequest(req, res, payload); return;
      }
      if (url.pathname === "/api/sessions" && req.method === "POST") { json(req, res, config, 201, service.start(await body(req, config.bodyLimitBytes) as never)); return; }
      const sm = url.pathname.match(/^\/api\/sessions\/([^/]+)$/); if (sm && req.method === "GET") { json(req, res, config, 200, service.get(sm[1]!)); return; }
      const title = url.pathname.match(/^\/api\/sessions\/([^/]+)\/title$/); if (title && req.method === "POST") { json(req, res, config, 200, service.renameSession({ ...(await body(req, config.bodyLimitBytes) as object), session_id: title[1]! } as never)); return; }
      const cards = url.pathname.match(/^\/api\/sessions\/([^/]+)\/cards$/); if (cards && req.method === "GET") { const since = url.searchParams.get("since_cursor"); json(req, res, config, 200, { cursor: service.get(cards[1]!).cursor, cards: service.store.listCards(cards[1]!, { sinceCursor: since === null ? undefined : Number(since), includeInactive: url.searchParams.get("include_inactive") === "true", type: url.searchParams.get("type") ?? undefined }) }); return; }
      const cap = url.pathname.match(/^\/api\/sessions\/([^/]+)\/capture$/); if (cap && req.method === "POST") { json(req, res, config, 200, await service.capture({ ...(await body(req, config.bodyLimitBytes) as object), session_id: cap[1]! } as never)); return; }
      const stat = url.pathname.match(/^\/api\/sessions\/([^/]+)\/status$/); if (stat && req.method === "POST") { json(req, res, config, 200, service.changeStatus({ ...(await body(req, config.bodyLimitBytes) as object), session_id: stat[1]! } as never)); return; }
      const exp = url.pathname.match(/^\/api\/sessions\/([^/]+)\/export\/(markdown|mermaid|json)$/); if (exp && req.method === "GET") { json(req, res, config, 200, service.export(exp[1]!, exp[2] as never)); return; }
      const cstat = url.pathname.match(/^\/api\/cards\/([^/]+)\/status$/); if (cstat && req.method === "POST") { json(req, res, config, 200, service.changeLearningStatus({ card_id: cstat[1]!, ...(await body(req, config.bodyLimitBytes) as object) } as never)); return; }
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
      const status = error instanceof HttpError ? error.status : 500;
      json(req, res, config, status, { error: error instanceof Error ? error.message : "unknown error", request_id: requestId });
    }
  });
  server.requestTimeout = config.requestTimeoutMs; server.headersTimeout = Math.min(config.requestTimeoutMs, 60_000); server.keepAliveTimeout = 5_000;
  shutdownHandlers.set(server, async () => {
    const closed = new Promise<void>((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()));
    await Promise.allSettled([...transports.values()].map(transport => transport.close())); transports.clear(); server.closeIdleConnections(); await closed;
  });
  return new Promise((resolvePromise, reject) => { server.once("error", reject); server.listen(config.port, config.host, () => { server.off("error", reject); resolvePromise(server); }); });
}

export async function stopHttp(server: Server): Promise<void> {
  const shutdown = shutdownHandlers.get(server);
  if (shutdown) { shutdownHandlers.delete(server); await shutdown(); return; }
  await new Promise<void>((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()));
}
