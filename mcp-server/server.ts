import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { KnowledgeService } from "../packages/knowledge-engine/service.js";

const PANEL_URI="ui://knowledge-copilot/panel.html";
const scope=z.object({mode:z.enum(["all","topic"]),topic:z.string().nullable()});
function result(value:unknown){return {content:[{type:"text" as const,text:JSON.stringify(value,null,2)}],structuredContent:value as Record<string,unknown>};}

export function createMcpServer(service:KnowledgeService):McpServer{
  const server=new McpServer({name:"knowledge-copilot",version:"0.1.0"});
  server.registerTool("start_learning_session",{description:"Create a persistent contextual-learning session.",inputSchema:{title:z.string().optional(),source_host:z.string().optional(),capture_scope:scope.optional()}},async input=>result(service.start(input)));
  server.registerTool("capture_conversation_turn",{description:"Capture one completed, authorized conversation turn. Replays are idempotent by idempotency_key, source_reference, or content hash.",inputSchema:{session_id:z.string(),user_message:z.string(),assistant_message:z.string(),tool_observations:z.array(z.string()).optional(),source_reference:z.string().optional(),idempotency_key:z.string().optional(),source_host:z.string().optional()}},async input=>result(await service.capture(input)));
  server.registerTool("get_learning_session",{description:"Get session state, real cursor, all cards, and learning debts.",inputSchema:{session_id:z.string()}},async input=>result(service.get(input.session_id)));
  server.registerTool("list_knowledge_cards",{description:"List cards, optionally only those changed after a real cursor.",inputSchema:{session_id:z.string(),since_cursor:z.number().int().nonnegative().optional(),include_inactive:z.boolean().optional(),type:z.string().optional()}},async input=>result({cursor:service.get(input.session_id).cursor,cards:service.store.listCards(input.session_id,{sinceCursor:input.since_cursor,includeInactive:input.include_inactive,type:input.type})}));
  server.registerTool("get_knowledge_card",{description:"Get one card with provenance and immutable revision history.",inputSchema:{card_id:z.string()}},async input=>result(service.getCard(input.card_id)));
  server.registerTool("revise_knowledge_card",{description:"Optimistically revise a card or change its learning status.",inputSchema:{card_id:z.string(),expected_revision:z.number().int().positive(),patch:z.record(z.unknown()),reason:z.string()}},async input=>result(service.revise(input)));
  server.registerTool("change_capture_status",{description:"Pause, resume, end, or narrow capture. Resume returns the real persisted boundary.",inputSchema:{session_id:z.string(),status:z.enum(["active","paused","ended"]),capture_scope:scope.optional()}},async input=>result(service.changeStatus(input)));
  server.registerTool("change_card_learning_status",{description:"Mark a card new, mastered, for review, or ignored.",inputSchema:{card_id:z.string(),status:z.enum(["new","mastered","review","ignored"])}},async input=>result(service.changeLearningStatus(input)));
  server.registerTool("list_learning_debts",{description:"List active learning-debt cards.",inputSchema:{session_id:z.string()}},async input=>result({cursor:service.get(input.session_id).cursor,learning_debts:service.store.listCards(input.session_id,{type:"learning_debt"})}));
  server.registerTool("export_learning_package",{description:"Re-read all persisted turns and reconstruct Markdown notes, Mermaid map, or complete JSON.",inputSchema:{session_id:z.string(),format:z.enum(["markdown","mermaid","json"])}},async input=>result(service.export(input.session_id,input.format)));

  registerAppTool(server,"open_knowledge_panel",{description:"Open the interactive knowledge panel for a session.",inputSchema:{session_id:z.string()},_meta:{ui:{resourceUri:PANEL_URI}}},async input=>result(service.get(input.session_id)));
  registerAppResource(server,"knowledge-panel",PANEL_URI,{},async()=>{
    const path=resolve("apps/knowledge-panel/dist/index.html");
    let html:string;
    try{html=await readFile(path,"utf8");}catch{html="<!doctype html><meta charset=utf-8><p>Knowledge panel is not built. Run npm run build:panel.</p>";}
    return {contents:[{uri:PANEL_URI,mimeType:RESOURCE_MIME_TYPE,text:html,_meta:{ui:{prefersBorder:true}}}]};
  });
  return server;
}
