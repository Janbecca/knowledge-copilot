import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { KnowledgeStore } from "../packages/storage/index.js";
import { LLMKnowledgeExtractor, MockKnowledgeExtractor, type KnowledgeExtractor } from "../packages/knowledge-engine/index.js";
import { KnowledgeService } from "../packages/knowledge-engine/service.js";
import { createMcpServer } from "./server.js";
import { startHttp } from "./http.js";

function extractor():KnowledgeExtractor{
  if((process.env.KNOWLEDGE_COPILOT_EXTRACTOR??"mock")==="mock")return new MockKnowledgeExtractor();
  const {KNOWLEDGE_COPILOT_BASE_URL:baseUrl,KNOWLEDGE_COPILOT_API_KEY:apiKey,KNOWLEDGE_COPILOT_MODEL:model}=process.env;
  if(!baseUrl||!apiKey||!model)throw new Error("LLM extractor requires BASE_URL, API_KEY, and MODEL; use mock without credentials.");
  return new LLMKnowledgeExtractor({baseUrl,apiKey,model,maxRepairs:Number(process.env.KNOWLEDGE_COPILOT_MAX_REPAIRS??1)});
}
const store=new KnowledgeStore();const service=new KnowledgeService(store,extractor());
if(process.argv.includes("--stdio")){await createMcpServer(service).connect(new StdioServerTransport());}
else{const port=Number(process.env.KNOWLEDGE_COPILOT_PORT??3210);await startHttp(service,port);console.log(`Knowledge Copilot MCP + preview: http://127.0.0.1:${port}`);}
