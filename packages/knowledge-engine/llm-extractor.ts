import { extractionResultSchema, type ExtractionResult } from "../card-protocol/index.js";
import type { ExtractionContext, KnowledgeExtractor } from "./types.js";

export interface LLMExtractorConfig { baseUrl:string; apiKey:string; model:string; maxRepairs?:number; fetchImpl?:typeof fetch; }
const SYSTEM = `You are a contextual-learning extraction engine. Return JSON only, conforming to the supplied event schema. Preserve main-task priority. Capture concepts, principles, methods, frameworks, valuable operations, corrections, and learning debt. Filter duplicate logs. Operations must distinguish read-only and mutation and include effect, purpose, mechanism, prerequisites, verification, risk, and reversibility. Use add/merge/revise/supersede/discard; do not keep contradicted active facts. This module implements capture-conversation-knowledge v2 card protocol 1.0; detailed policy remains in the versioned reference files.`;

export class LLMKnowledgeExtractor implements KnowledgeExtractor {
  readonly name="llm"; private fetchImpl:typeof fetch;
  constructor(private config:LLMExtractorConfig){this.fetchImpl=config.fetchImpl??fetch;}
  async extract(context: ExtractionContext): Promise<ExtractionResult> {
    let feedback=""; const max=this.config.maxRepairs??1; let last:unknown;
    for(let attempt=0;attempt<=max;attempt++){
      const response=await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/,"")}/chat/completions`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${this.config.apiKey}`},body:JSON.stringify({model:this.config.model,response_format:{type:"json_object"},messages:[{role:"system",content:SYSTEM},{role:"user",content:JSON.stringify({turn:context.turn,active_cards:context.activeCards,feedback})}]})});
      if(!response.ok) throw new Error(`LLM extractor HTTP ${response.status}`);
      const body=await response.json() as {choices?:Array<{message?:{content?:string}}>};
      const content=body.choices?.[0]?.message?.content??"";
      try { last=JSON.parse(content); const parsed=extractionResultSchema.safeParse(last); if(parsed.success)return parsed.data; feedback=`Schema errors: ${parsed.error.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; ")}`; }
      catch(error){ feedback=`Invalid JSON: ${error instanceof Error?error.message:"parse error"}`; }
    }
    console.error("LLM extraction rejected after schema repair attempts", { extractor:this.name, error:feedback });
    throw new Error(`LLM extraction invalid: ${feedback}; candidate was not persisted (${typeof last})`);
  }
}
