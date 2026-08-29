import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { KnowledgeService } from "../packages/knowledge-engine/service.js";
import { knowledgeItemSchema } from "../packages/knowledge-engine/model-knowledge.js";
import { cardEventSchema, knowledgeCardSchema } from "../packages/card-protocol/index.js";
import { captureScopeSchema, extractionModeSchema, sessionSchema, stableHash, turnSchema } from "../packages/shared/index.js";
import { IdentityService, type AccessContext, type AccessScope } from "../packages/identity/index.js";
import { AuthenticationError, requireScope } from "./auth.js";

const PANEL_URI="ui://knowledge-copilot/panel-v3.html";
const scope=captureScopeSchema;
const generatedTitle=z.string().trim().min(1).max(80).describe("A concise title generated from the current conversation topic when the user did not provide one. Do not ask the user for a title when the available context is sufficient.");
function result(value:unknown){return {content:[{type:"text" as const,text:JSON.stringify(value,null,2)}],structuredContent:value as Record<string,unknown>};}
function errorResult(error:unknown){
  const sourceMessage=error instanceof Error?error.message:"unknown error";
  const code=error instanceof AuthenticationError?"forbidden":sourceMessage.includes("not found")?"not_found":sourceMessage.includes("conflict")?"conflict":"internal_error";
  const message=code==="internal_error"?"operation failed":sourceMessage;
  const value={error:{code,message}};
  return {content:[{type:"text" as const,text:JSON.stringify(value,null,2)}],isError:true};
}
function conversationSource(extra:unknown):string|undefined{const meta=(extra as {_meta?:Record<string,unknown>}|undefined)?._meta;const session=meta?.["openai/session"];if(typeof session!=="string"||!session)return undefined;const subject=typeof meta?.["openai/subject"]==="string"?meta["openai/subject"]:"anonymous";return `chatgpt:${stableHash({subject,session})}`;}
async function safely(operation:()=>unknown|Promise<unknown>){try{return result(await operation());}catch(error){return errorResult(error);}}

const annotations={
  read:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  create:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false},
  capture:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  revise:{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:false},
  mutate:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false},
  update:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  export:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false},
} as const;

const revisionSchema=z.object({revision:z.number().int().positive(),event_type:z.string(),reason:z.string(),at_turn:z.string(),payload:knowledgeCardSchema,created_at:z.string()});
const sessionStateSchema=z.object({session:sessionSchema,cursor:z.number().int().nonnegative(),cards:z.array(knowledgeCardSchema),learning_debts:z.array(knowledgeCardSchema)});
const desktopWakeSchema=z.object({status:z.enum(["ready","not_paired"]),deep_link:z.string().optional(),expires_at:z.string().optional(),install_url:z.string()});
const launchStateSchema=sessionStateSchema.extend({capture_policy:z.literal("continuous_until_paused"),next_tool:z.literal("capture_active_learning_turn"),desktop:desktopWakeSchema.optional()});
const captureResultSchema=z.object({idempotent_replay:z.boolean(),turn:turnSchema,operations:z.array(cardEventSchema),new_cards:z.array(knowledgeCardSchema),changed_cards:z.array(knowledgeCardSchema),new_learning_debts:z.array(knowledgeCardSchema),cursor:z.number().int().positive(),session_status:z.enum(["active","paused","ended"])});
const cardListSchema=z.object({cursor:z.number().int().nonnegative(),cards:z.array(knowledgeCardSchema)});
const cardDetailSchema=z.object({card:knowledgeCardSchema,revisions:z.array(revisionSchema)});
const captureStatusSchema=z.object({session:sessionSchema,previous_status:z.enum(["active","paused","ended"]),resume_from_cursor:z.number().int().nonnegative().nullable()});
const extractionModeResultSchema=z.object({session:sessionSchema,previous_extraction_mode:extractionModeSchema,server_extractor:z.string()});
const debtListSchema=z.object({cursor:z.number().int().nonnegative(),learning_debts:z.array(knowledgeCardSchema)});
const exportSchema=z.object({export_id:z.string(),format:z.enum(["markdown","mermaid","json"]),source_cursor:z.number().int().nonnegative(),content:z.string()});

const developmentAccess:AccessContext={subject:"local-development",userId:null,scopes:new Set(["knowledge:read","knowledge:write","device:manage","capture:write"]),authType:"development"};

export function createMcpServer(service:KnowledgeService,access:AccessContext=developmentAccess):McpServer{
  const server=new McpServer({name:"knowledge-copilot",version:"0.1.0"});
  const identity=new IdentityService(service.store);
  const authorized=<T>(scope:AccessScope,operation:()=>T):T=>{requireScope(access,scope);return operation();};
  const desktopWake=(sessionId:string,sourceHost:string,deviceId?:string)=>{
    const install_url="https://knowledge-copilot.xyz/install/";
    if(!access.userId||!access.scopes.has("device:manage"))return {status:"not_paired" as const,install_url};
    const device=identity.listDevices(access.userId).find(item=>!item.revoked_at&&(!deviceId||item.device_id===deviceId));
    if(!device)return {status:"not_paired" as const,install_url};
    const wake=identity.issueWakeToken(access.userId,{deviceId:device.device_id,sessionId,sourceHost});
    return {status:"ready" as const,deep_link:wake.deep_link,expires_at:wake.expires_at,install_url};
  };
  server.registerTool("start_learning_session",{title:"Start learning session",description:"Use this when the user asks to start knowledge capture without opening the panel. Generate a concise title from the current conversation when the user did not supply one, then create a persistent learning session. Default to host_structured so the current AI supplies knowledge_items without a second model charge.",inputSchema:{title:generatedTitle.optional(),source_host:z.string().optional(),capture_scope:scope.optional(),extraction_mode:extractionModeSchema.optional()},outputSchema:sessionSchema,annotations:annotations.create},(input,extra)=>safely(()=>authorized("knowledge:write",()=>service.start({...input,source_host:conversationSource(extra)??input.source_host},access.userId))));
  server.registerTool("rename_learning_session",{title:"Rename learning session",description:"Use this when the user asks to rename or edit the title of an existing Knowledge Copilot learning session.",inputSchema:{session_id:z.string(),title:z.string().trim().min(1).max(80).describe("The new concise user-facing session title.")},outputSchema:sessionSchema,annotations:annotations.update},input=>safely(()=>authorized("knowledge:write",()=>service.renameSession(input,access.userId))));
  server.registerTool("capture_conversation_turn",{title:"Capture conversation turn",description:"Persist one completed authorized turn. In server_llm mode the configured server model extracts cards. In host_structured mode provide knowledge_items distilled by the current AI.",inputSchema:{session_id:z.string(),user_message:z.string(),assistant_message:z.string(),knowledge_items:z.array(knowledgeItemSchema).max(8).optional(),tool_observations:z.array(z.string()).optional(),source_reference:z.string().optional(),idempotency_key:z.string().optional(),source_host:z.string().optional()},outputSchema:captureResultSchema,annotations:annotations.capture},input=>safely(()=>authorized("capture:write",()=>service.capture(input,access.userId))));
  server.registerTool("capture_active_learning_turn",{title:"Continue active knowledge capture",description:"After Knowledge Copilot has been launched once in this ChatGPT conversation, use this after EVERY subsequent substantive answer even when the user does not @mention the plugin again. In host_structured mode, distill 1-5 reusable items and send knowledge_items (or [] when nothing is reusable). In server_llm mode, omit knowledge_items because the server extracts the redacted turn. The active session is resolved automatically from the ChatGPT conversation.",inputSchema:{session_id:z.string().optional().describe("Usually omit this in ChatGPT; the active session is bound to the conversation."),user_message:z.string(),assistant_message:z.string(),knowledge_items:z.array(knowledgeItemSchema).max(8).optional(),tool_observations:z.array(z.string()).optional(),source_reference:z.string().optional(),idempotency_key:z.string().optional()},outputSchema:captureResultSchema,annotations:annotations.capture},(input,extra)=>safely(()=>authorized("capture:write",()=>service.capture({...input,source_host:conversationSource(extra)},access.userId))));
  server.registerTool("get_learning_session",{title:"Get learning session",description:"Read one learning session, its persisted cursor, cards, and active learning debts without modifying state.",inputSchema:{session_id:z.string()},outputSchema:sessionStateSchema,annotations:annotations.read},input=>safely(()=>authorized("knowledge:read",()=>service.get(input.session_id,access.userId))));
  server.registerTool("list_knowledge_cards",{title:"List knowledge cards",description:"Read cards in one session, optionally filtering to changes after a persisted cursor, lifecycle, or card type.",inputSchema:{session_id:z.string(),since_cursor:z.number().int().nonnegative().optional(),include_inactive:z.boolean().optional(),type:z.string().optional()},outputSchema:cardListSchema,annotations:annotations.read},input=>safely(()=>authorized("knowledge:read",()=>({
    cursor:service.get(input.session_id,access.userId).cursor,
    cards:service.store.listCards(input.session_id,{sinceCursor:input.since_cursor,includeInactive:input.include_inactive,type:input.type})
  }))));
  server.registerTool("get_knowledge_card",{title:"Get knowledge card",description:"Read one knowledge card with provenance and immutable revision history.",inputSchema:{card_id:z.string()},outputSchema:cardDetailSchema,annotations:annotations.read},input=>safely(()=>authorized("knowledge:read",()=>service.getCard(input.card_id,access.userId))));
  server.registerTool("revise_knowledge_card",{title:"Revise knowledge card",description:"Replace selected fields of an existing card when its expected revision still matches, preserving revision history.",inputSchema:{card_id:z.string(),expected_revision:z.number().int().positive(),patch:z.record(z.unknown()),reason:z.string()},outputSchema:knowledgeCardSchema,annotations:annotations.revise},input=>safely(()=>authorized("knowledge:write",()=>service.revise(input,access.userId))));
  server.registerTool("change_capture_status",{title:"Change capture status",description:"Pause, resume, end, or narrow an existing session's capture scope. Resume reports the persisted cursor boundary.",inputSchema:{session_id:z.string(),status:z.enum(["active","paused","ended"]),capture_scope:scope.optional()},outputSchema:captureStatusSchema,annotations:annotations.mutate},input=>safely(()=>authorized("knowledge:write",()=>service.changeStatus(input,access.userId))));
  server.registerTool("change_extraction_mode",{title:"Change extraction mode",description:"Switch this session between host_structured (the current AI supplies structured knowledge_items) and server_llm (the configured server model extracts the raw turn).",inputSchema:{session_id:z.string(),extraction_mode:extractionModeSchema},outputSchema:extractionModeResultSchema,annotations:annotations.update},input=>safely(()=>authorized("knowledge:write",()=>service.changeExtractionMode(input,access.userId))));
  server.registerTool("change_card_learning_status",{title:"Change card learning status",description:"Update an existing card's learning status while preserving its revision history.",inputSchema:{card_id:z.string(),status:z.enum(["new","mastered","review","ignored"])},outputSchema:knowledgeCardSchema,annotations:annotations.mutate},input=>safely(()=>authorized("knowledge:write",()=>service.changeLearningStatus(input,access.userId))));
  server.registerTool("list_learning_debts",{title:"List learning debts",description:"Read active learning-debt cards for one session without modifying state.",inputSchema:{session_id:z.string()},outputSchema:debtListSchema,annotations:annotations.read},input=>safely(()=>authorized("knowledge:read",()=>({
    cursor:service.get(input.session_id,access.userId).cursor,
    learning_debts:service.store.listCards(input.session_id,{type:"learning_debt"})
  }))));
  server.registerTool("export_learning_package",{title:"Export learning package",description:"Create a stored Markdown, Mermaid, or JSON export reconstructed from one session's persisted turns and cards.",inputSchema:{session_id:z.string(),format:z.enum(["markdown","mermaid","json"])},outputSchema:exportSchema,annotations:annotations.export},input=>safely(()=>authorized("knowledge:read",()=>service.export(input.session_id,input.format,access.userId))));

  registerAppTool(server,"launch_knowledge_copilot",{title:"Launch Knowledge Copilot",description:"Use this whenever the user explicitly invokes or @mentions Knowledge Copilot, says 开启知识沉淀、打开笔记、记录本轮、知识副驾驶, or otherwise asks to launch the learning sidecar. Reuse the session already bound to this ChatGPT conversation when present; otherwise generate a concise title, create one in host_structured mode by default, and render the panel. The returned capture_policy means you must call capture_active_learning_turn after every later substantive answer without requiring another mention.",inputSchema:{session_id:z.string().optional().describe("Existing learning session ID, when one is already active in the conversation."),title:generatedTitle.optional(),source_host:z.string().optional(),extraction_mode:extractionModeSchema.optional()},outputSchema:launchStateSchema,annotations:annotations.update,_meta:{ui:{resourceUri:PANEL_URI},"openai/outputTemplate":PANEL_URI,"openai/toolInvocation/invoking":"Opening knowledge notes…","openai/toolInvocation/invoked":"Knowledge notes opened."}},(input,extra)=>safely(()=>authorized("knowledge:write",()=>{const source=conversationSource(extra)??input.source_host??"chatgpt";const state=service.launch({...input,source_host:source},access.userId);return {...state,desktop:desktopWake(state.session.session_id,source)};})));
  server.registerTool("wake_desktop_copilot",{title:"Wake desktop cockpit",description:"Create a short-lived one-time deep link for the user's paired desktop device. If no active device is paired, return the installation guide instead.",inputSchema:{session_id:z.string(),source_host:z.string().optional(),device_id:z.string().optional()},outputSchema:desktopWakeSchema,annotations:annotations.create},input=>safely(()=>authorized("knowledge:read",()=>{service.get(input.session_id,access.userId);return desktopWake(input.session_id,input.source_host??"mcp",input.device_id);} )));
  registerAppTool(server,"open_knowledge_panel",{title:"Open knowledge panel",description:"Use this to reopen and render the interactive notes panel for a known learning session without modifying it.",inputSchema:{session_id:z.string()},outputSchema:sessionStateSchema,annotations:annotations.read,_meta:{ui:{resourceUri:PANEL_URI},"openai/outputTemplate":PANEL_URI,"openai/toolInvocation/invoking":"Opening knowledge notes…","openai/toolInvocation/invoked":"Knowledge notes opened."}},input=>safely(()=>authorized("knowledge:read",()=>service.get(input.session_id,access.userId))));
  registerAppResource(server,"knowledge-panel",PANEL_URI,{},async()=>{
    const path=resolve("apps/knowledge-panel/dist/index.html");
    let html:string;
    try{html=await readFile(path,"utf8");}catch{html="<!doctype html><meta charset=utf-8><p>Knowledge panel is not built. Run npm run build:panel.</p>";}
    return {contents:[{uri:PANEL_URI,mimeType:RESOURCE_MIME_TYPE,text:html,_meta:{ui:{prefersBorder:false,domain:"https://knowledge-copilot.xyz",csp:{connectDomains:["https://knowledge-copilot.xyz"],resourceDomains:[]}},"openai/widgetDescription":"A continuously updating learning notebook for the active ChatGPT conversation.","openai/widgetPrefersBorder":false,"openai/widgetDomain":"https://knowledge-copilot.xyz","openai/widgetCSP":{connect_domains:["https://knowledge-copilot.xyz"],resource_domains:[],redirect_domains:["https://knowledge-copilot.xyz"]}}}]};
  });
  return server;
}
