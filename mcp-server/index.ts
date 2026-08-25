import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { KnowledgeStore } from "../packages/storage/index.js";
import { LLMKnowledgeExtractor, MockKnowledgeExtractor, type KnowledgeExtractor } from "../packages/knowledge-engine/index.js";
import { KnowledgeService } from "../packages/knowledge-engine/service.js";
import { loadConfig } from "./config.js";
import { createMcpServer } from "./server.js";
import { startHttp, stopHttp } from "./http.js";

function extractor(): KnowledgeExtractor {
  if ((process.env.KNOWLEDGE_COPILOT_EXTRACTOR ?? "mock") === "mock") return new MockKnowledgeExtractor();
  const { KNOWLEDGE_COPILOT_BASE_URL: baseUrl, KNOWLEDGE_COPILOT_API_KEY: apiKey, KNOWLEDGE_COPILOT_MODEL: model } = process.env;
  if (!baseUrl || !apiKey || !model) throw new Error("LLM extractor requires BASE_URL, API_KEY, and MODEL; use mock without credentials.");
  return new LLMKnowledgeExtractor({ baseUrl, apiKey, model, maxRepairs: Number(process.env.KNOWLEDGE_COPILOT_MAX_REPAIRS ?? 1) });
}

const config = loadConfig(); const store = new KnowledgeStore(config.database); const service = new KnowledgeService(store, extractor());
if (process.argv.includes("--stdio")) {
  await createMcpServer(service).connect(new StdioServerTransport());
} else {
  const server = await startHttp(service, config);
  console.log(JSON.stringify({ level: "info", event: "server_started", host: config.host, port: config.port, public_base_url: config.publicBaseUrl, log_level: config.logLevel }));
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return; stopping = true;
    console.log(JSON.stringify({ level: "info", event: "server_stopping", signal }));
    const force = setTimeout(() => process.exit(1), 10_000); force.unref();
    try { await stopHttp(server); store.close(); }
    catch (error) { console.error(JSON.stringify({ level: "error", event: "shutdown_failed", message: error instanceof Error ? error.message : "unknown" })); process.exitCode = 1; }
    finally { clearTimeout(force); }
  };
  process.once("SIGTERM", () => { void shutdown("SIGTERM"); }); process.once("SIGINT", () => { void shutdown("SIGINT"); });
}
