import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
const transport=new StdioClientTransport({command:process.execPath,args:["dist/mcp-server/index.js","--stdio"],env:{...process.env,KNOWLEDGE_COPILOT_EXTRACTOR:"mock",KNOWLEDGE_COPILOT_DB:join(tmpdir(),`knowledge-copilot-smoke-${randomUUID()}.sqlite`)} as Record<string,string>});
const client=new Client({name:"knowledge-copilot-smoke",version:"0.1.0"});
try{
 await client.connect(transport);
 const tools=await client.listTools();
 const required=["start_learning_session","capture_conversation_turn","get_learning_session","export_learning_package","open_knowledge_panel"];
 for(const name of required)if(!tools.tools.some(t=>t.name===name))throw new Error(`missing tool ${name}`);
 for(const tool of tools.tools){
  if(!tool.outputSchema)throw new Error(`missing output schema for ${tool.name}`);
  if(tool.annotations?.openWorldHint!==false)throw new Error(`tool ${tool.name} must declare a closed world`);
 }
 const started=await client.callTool({name:"start_learning_session",arguments:{title:"MCP smoke",source_host:"sdk-smoke"}});const session=started.structuredContent as any;
 const captured=await client.callTool({name:"capture_conversation_turn",arguments:{session_id:session.session_id,user_message:"运行 esptool read-flash 保存固件",assistant_message:"读取完成，请验证文件大小和哈希",source_reference:"smoke-turn-1"}});const capture=captured.structuredContent as any;
 const state=await client.callTool({name:"get_learning_session",arguments:{session_id:session.session_id}});const current=state.structuredContent as any;
 if(capture.cursor!==1||current.cards.length!==1||current.cards[0].type!=="operation")throw new Error("MCP capture state mismatch");
 console.log(JSON.stringify({ok:true,tool_count:tools.tools.length,contracts_declared:true,session_id:session.session_id,cursor:capture.cursor,card_type:current.cards[0].type,ui_tool:tools.tools.some(t=>t.name==="open_knowledge_panel")},null,2));
}finally{await client.close();}
