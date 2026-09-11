import type { ExtractionResult } from "../card-protocol/index.js";
import { knowledgeItemsResponseSchema, modelKnowledgeItemsToEvents } from "./model-knowledge.js";
import type { ExtractionContext, KnowledgeExtractor } from "./types.js";

export interface LLMExtractorConfig { baseUrl:string; apiKey:string; model:string; maxRepairs?:number; fetchImpl?:typeof fetch; }
const SYSTEM = `You are a contextual-learning extraction engine. Return one JSON object only, with no Markdown or commentary.
The exact top-level shape is: {"knowledge_items": [...]}. Return 0 to 5 durable, reusable items; use [] when the turn has no reusable knowledge.
Each item must contain:
- type: one of concept, principle, method, operation, framework, correction, learning_debt
- title: concise string
- summary: self-contained string
Optional keys are mechanism (string), reasoning_chain (string array), boundary (string), transfer (string array), tags (string array), and confidence (high, medium, low, or unknown).
Do not create IDs, card lifecycle events, provenance, revisions, or fields outside this schema. The server owns those fields.
Preserve main-task priority, filter progress noise and duplicates, and capture corrections instead of retaining disproved claims. Never reproduce credentials or secrets.`;

export class LLMKnowledgeExtractor implements KnowledgeExtractor {
  readonly name="llm"; private fetchImpl:typeof fetch;
  constructor(private config:LLMExtractorConfig){this.fetchImpl=config.fetchImpl??fetch;}
  async extract(context: ExtractionContext): Promise<ExtractionResult> {
    let feedback=""; const max=this.config.maxRepairs??1; let last:unknown;
    for(let attempt=0;attempt<=max;attempt++){
      const activeCards=context.activeCards.map(card=>({card_id:card.card_id,type:card.type,title:card.title,summary:card.summary,tags:card.tags}));
      const response=await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/,"")}/chat/completions`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${this.config.apiKey}`},body:JSON.stringify({model:this.config.model,response_format:{type:"json_object"},max_tokens:1600,messages:[{role:"system",content:SYSTEM},{role:"user",content:JSON.stringify({turn:context.turn,active_cards:activeCards,validation_feedback:feedback||null})}]})});
      if(!response.ok) throw new Error(`LLM extractor HTTP ${response.status}`);
      const body=await response.json() as {choices?:Array<{message?:{content?:string}}>};
      const content=body.choices?.[0]?.message?.content??"";
      try { last=JSON.parse(content); const parsed=knowledgeItemsResponseSchema.safeParse(last); if(parsed.success)return {events:modelKnowledgeItemsToEvents(context.turn,parsed.data.knowledge_items,context.activeCards)}; feedback=`Schema errors: ${parsed.error.issues.map(i=>`${i.path.join(".")}: ${i.message}`).join("; ")}`; }
      catch(error){ feedback=`Invalid JSON: ${error instanceof Error?error.message:"parse error"}`; }
    }
    console.error("LLM extraction rejected after schema repair attempts", { extractor:this.name, error:feedback });
    throw new Error(`LLM extraction invalid: ${feedback}; candidate was not persisted (${typeof last})`);
  }
}
