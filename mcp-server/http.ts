import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { KnowledgeService } from "../packages/knowledge-engine/service.js";
import { createMcpServer } from "./server.js";

async function body(req:IncomingMessage):Promise<any>{const chunks:Buffer[]=[];for await(const c of req)chunks.push(Buffer.from(c));return chunks.length?JSON.parse(Buffer.concat(chunks).toString("utf8")):{};}
function json(res:ServerResponse,status:number,data:unknown){res.writeHead(status,{"content-type":"application/json; charset=utf-8","access-control-allow-origin":"*"});res.end(JSON.stringify(data));}

export function startHttp(service:KnowledgeService,port:number):Promise<Server>{
  const transports=new Map<string,StreamableHTTPServerTransport>();
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url??"/","http://localhost");
      if(url.pathname==="/health"){json(res,200,{ok:true,extractor:service.extractor.name});return;}
      if(url.pathname==="/mcp"){
        const sessionId=req.headers["mcp-session-id"] as string|undefined;
        let transport=sessionId?transports.get(sessionId):undefined;
        const payload=req.method==="POST"?await body(req):undefined;
        if(!transport&&req.method==="POST"&&isInitializeRequest(payload)){
          transport=new StreamableHTTPServerTransport({sessionIdGenerator:()=>randomUUID(),onsessioninitialized:id=>{transports.set(id,transport!);},onsessionclosed:id=>{transports.delete(id);}});
          await createMcpServer(service).connect(transport);
        }
        if(!transport){json(res,400,{error:"missing or invalid MCP session"});return;}
        await transport.handleRequest(req,res,payload);return;
      }
      if(url.pathname==="/api/sessions"&&req.method==="POST"){json(res,201,service.start(await body(req)));return;}
      const sm=url.pathname.match(/^\/api\/sessions\/([^/]+)$/);if(sm&&req.method==="GET"){json(res,200,service.get(sm[1]!));return;}
      const cards=url.pathname.match(/^\/api\/sessions\/([^/]+)\/cards$/);if(cards&&req.method==="GET"){const since=url.searchParams.get("since_cursor");json(res,200,{cursor:service.get(cards[1]!).cursor,cards:service.store.listCards(cards[1]!,{sinceCursor:since===null?undefined:Number(since),includeInactive:url.searchParams.get("include_inactive")==="true",type:url.searchParams.get("type")??undefined})});return;}
      const cap=url.pathname.match(/^\/api\/sessions\/([^/]+)\/capture$/);if(cap&&req.method==="POST"){json(res,200,await service.capture({...(await body(req)),session_id:cap[1]!}));return;}
      const stat=url.pathname.match(/^\/api\/sessions\/([^/]+)\/status$/);if(stat&&req.method==="POST"){json(res,200,service.changeStatus({...(await body(req)),session_id:stat[1]!}));return;}
      const exp=url.pathname.match(/^\/api\/sessions\/([^/]+)\/export\/(markdown|mermaid|json)$/);if(exp&&req.method==="GET"){json(res,200,service.export(exp[1]!,exp[2] as never));return;}
      const cstat=url.pathname.match(/^\/api\/cards\/([^/]+)\/status$/);if(cstat&&req.method==="POST"){json(res,200,service.changeLearningStatus({card_id:cstat[1]!,...(await body(req))}));return;}
      if(url.pathname==="/"||url.pathname.startsWith("/assets/")){const rel=url.pathname==="/"?"index.html":url.pathname.slice(1);const path=join(resolve("apps/knowledge-panel/dist"),rel);const data=await readFile(path);const mime:Record<string,string>={".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css"};res.writeHead(200,{"content-type":mime[extname(path)]??"application/octet-stream"});res.end(data);return;}
      json(res,404,{error:"not found"});
    }catch(error){json(res,500,{error:error instanceof Error?error.message:"unknown error"});}
  });
  return new Promise<Server>(resolvePromise=>server.listen(port,"127.0.0.1",()=>resolvePromise(server)));
}
