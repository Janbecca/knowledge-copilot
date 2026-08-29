import { knowledgeCardSchema, type CardEvent, type KnowledgeCard } from "../card-protocol/index.js";
import { reconstructExport, type ExportFormat } from "../export-engine/index.js";
import { id, now, redact, stableHash, type ExtractionMode, type Session, type Turn } from "../shared/index.js";
import { KnowledgeStore } from "../storage/index.js";
import type { KnowledgeExtractor } from "./types.js";

export interface ModelKnowledgeItem {
  type:"concept"|"principle"|"method"|"operation"|"framework"|"correction"|"learning_debt";
  title:string; summary:string; mechanism?:string; reasoning_chain?:string[]; boundary?:string; transfer?:string[]; tags?:string[];
  confidence?:"high"|"medium"|"low"|"unknown";
}

export class KnowledgeService {
  constructor(readonly store:KnowledgeStore,readonly extractor:KnowledgeExtractor){}
  start(input:{title?:string;source_host?:string;capture_scope?:{mode:"all"|"topic";topic:string|null};extraction_mode?:ExtractionMode}={}):Session{
    const at=now();return this.store.createSession({session_id:id("session"),title:this.normalizedTitle(input.title,"待命名学习会话"),status:"active",capture_scope:input.capture_scope??{mode:"all",topic:null},created_at:at,updated_at:at,last_captured_turn:0,source_host:input.source_host??"unknown",extraction_mode:input.extraction_mode??"host_structured"});
  }
  renameSession(input:{session_id:string;title:string}):Session{const session=this.requireSession(input.session_id);session.title=this.normalizedTitle(input.title);session.updated_at=now();this.store.updateSession(session);return session;}
  launch(input:{session_id?:string;title?:string;source_host?:string;extraction_mode?:ExtractionMode}={}){const session=input.session_id?this.requireSession(input.session_id):(input.source_host?this.store.findActiveSessionBySourceHost(input.source_host):null)??this.start({title:input.title,source_host:input.source_host??"chatgpt",extraction_mode:input.extraction_mode});return {...this.get(session.session_id),capture_policy:"continuous_until_paused",next_tool:"capture_active_learning_turn" as const};}
  get(sessionId:string){const session=this.requireSession(sessionId);return {session,cursor:session.last_captured_turn,cards:this.store.listCards(sessionId,{includeInactive:true}),learning_debts:this.store.listCards(sessionId,{type:"learning_debt"})};}
  async capture(input:{session_id?:string;user_message:string;assistant_message:string;tool_observations?:string[];source_reference?:string;idempotency_key?:string;source_host?:string;knowledge_items?:ModelKnowledgeItem[]}){
    const session=input.session_id?this.requireSession(input.session_id):(input.source_host?this.store.findActiveSessionBySourceHost(input.source_host):null);
    if(!session)throw new Error("no active learning session for this conversation; launch Knowledge Copilot first");
    const key=input.idempotency_key??(input.source_reference?`source:${input.source_reference}`:stableHash({u:input.user_message,a:input.assistant_message,t:input.tool_observations??[]}));
    const existing=this.store.findTurnByKey(session.session_id,key);
    if(existing)return {idempotent_replay:true,turn:existing,operations:this.store.listEvents(session.session_id,existing.cursor),...this.captureSummary(session,existing.cursor)};
    const cursor=session.last_captured_turn+1; const turn:Turn={turn_id:id("turn"),session_id:session.session_id,user_message:redact(input.user_message),assistant_message:redact(input.assistant_message),tool_observations:(input.tool_observations??[]).map(redact),created_at:now(),source_reference:input.source_reference??null,idempotency_key:key,cursor};
    const activeCards=this.store.listCards(session.session_id);
    let events:CardEvent[]=[];
    if(session.status==="active"){
      if(session.extraction_mode==="host_structured"){
        if(input.knowledge_items===undefined)throw new Error("host_structured mode requires knowledge_items from the host AI");
        events=this.modelEvents(turn,input.knowledge_items,activeCards);
      }else{
        events=(await this.extractor.extract({session,turn,activeCards})).events;
      }
    }
    const applied:CardEvent[]=[];session.last_captured_turn=cursor;session.updated_at=now();if(input.source_host)session.source_host=input.source_host;
    this.store.db.exec("BEGIN");
    try{this.store.insertTurn(turn);this.store.updateSession(session);for(const event of events){this.applyEvent(session.session_id,cursor,event);applied.push(event);}this.store.db.exec("COMMIT");}catch(error){this.store.db.exec("ROLLBACK");throw error;}
    return {idempotent_replay:false,turn,operations:applied,...this.captureSummary(session,cursor)};
  }
  private captureSummary(session:Session,cursor:number){const cards=this.store.listCards(session.session_id,{sinceCursor:cursor-1,includeInactive:true});return {new_cards:cards.filter(c=>c.revision===1&&c.lifecycle==="active"),changed_cards:cards.filter(c=>c.revision>1||c.lifecycle!=="active"),new_learning_debts:cards.filter(c=>c.type==="learning_debt"&&c.lifecycle==="active"),cursor,session_status:session.status};}
  private modelEvents(turn:Turn,items:ModelKnowledgeItem[],active:KnowledgeCard[]):CardEvent[]{return items.flatMap((item):CardEvent[]=>{
    const title=redact(item.title.trim());const summary=redact(item.summary.trim());if(!title||!summary)return [];
    const body={definition_or_claim:summary,mechanism:item.mechanism?redact(item.mechanism):null,reasoning_chain:(item.reasoning_chain??[]).map(redact),boundary:item.boundary?redact(item.boundary):null,transfer:(item.transfer??[]).map(redact)};
    const tags=[...new Set((item.tags??[]).map(tag=>redact(tag.trim())).filter(Boolean))];
    const existing=active.find(card=>card.lifecycle==="active"&&card.title.trim().toLocaleLowerCase()===title.toLocaleLowerCase());
    if(existing){if(existing.summary===summary&&JSON.stringify(existing.body)===JSON.stringify(body))return [];return [{event:"revise" as const,card_id:existing.card_id,at_turn:turn.turn_id,reason:"updated by a later completed conversation turn",patch:{summary,body,tags:[...new Set([...existing.tags,...tags])],confidence:item.confidence??"medium",evidence_status:"inferred"}}];}
    const card:KnowledgeCard={card_id:id("card"),revision:1,type:item.type,title,summary,body,operation:null,learning_debt:item.type==="learning_debt"?{question:title,origin:turn.turn_id,learning_value:summary,task_relation:"Captured from the active conversation for later study.",recommended_stage:"after_task"}:null,provenance:[{turn_ref:turn.turn_id,speaker:"assistant",kind:"inference",excerpt:summary}],confidence:item.confidence??"medium",evidence_status:"inferred",learning_status:"new",lifecycle:"active",supersedes:[],created_at_turn:turn.turn_id,updated_at_turn:turn.turn_id,tags};
    return [{event:"add" as const,card_id:card.card_id,at_turn:turn.turn_id,reason:"knowledge distilled by the host model from a completed turn",card}];
  });}
  private applyEvent(sessionId:string,cursor:number,event:CardEvent):void{
    let current=this.store.getCard(event.card_id); let next:KnowledgeCard;
    if(event.event==="add"){if(!event.card)throw new Error("add requires card");next=event.card;}
    else if(event.event==="supersede"){
      if(!current||!event.card)throw new Error("supersede requires current and replacement card");
      const old={...current,revision:current.revision+1,lifecycle:"superseded" as const,evidence_status:"superseded" as const,updated_at_turn:event.at_turn};this.store.saveEvent(sessionId,cursor,event,old);
      next=event.card; this.store.saveEvent(sessionId,cursor,{...event,card_id:next.card_id},next);return;
    } else {if(!current)throw new Error(`${event.event} requires existing card`); next=structuredClone(current);next.revision++;next.updated_at_turn=event.at_turn;
      if(event.event==="revise")Object.assign(next,event.patch??{});
      if(event.event==="merge"){for(const mergedId of event.merged_card_ids??[]){const merged=this.store.getCard(mergedId);if(merged){next.provenance.push(...merged.provenance);const discarded={...merged,revision:merged.revision+1,lifecycle:"discarded" as const,updated_at_turn:event.at_turn};this.store.saveEvent(sessionId,cursor,{...event,card_id:mergedId},discarded);}}}
      if(event.event==="discard")next.lifecycle="discarded";
      if(event.event==="status_change"&&event.learning_status)next.learning_status=event.learning_status;
    }
    next=knowledgeCardSchema.parse(next);this.store.saveEvent(sessionId,cursor,event,next);
  }
  revise(input:{card_id:string;expected_revision:number;patch:Record<string,unknown>;reason:string}){const card=this.store.getCard(input.card_id);if(!card)throw new Error("card not found");if(card.revision!==input.expected_revision)throw new Error(`revision conflict: current ${card.revision}`);const sessionId=this.findCardSession(input.card_id);const session=this.requireSession(sessionId);const event:CardEvent={event:"revise",card_id:card.card_id,at_turn:`manual:${session.last_captured_turn}`,reason:input.reason,patch:input.patch};this.applyEvent(sessionId,session.last_captured_turn,event);return this.store.getCard(card.card_id);}
  changeStatus(input:{session_id:string;status:"active"|"paused"|"ended";capture_scope?:{mode:"all"|"topic";topic:string|null}}){const s=this.requireSession(input.session_id);const previous=s.status;s.status=input.status;if(input.capture_scope)s.capture_scope=input.capture_scope;s.updated_at=now();this.store.updateSession(s);return {session:s,previous_status:previous,resume_from_cursor:input.status==="active"?s.last_captured_turn:null};}
  changeExtractionMode(input:{session_id:string;extraction_mode:ExtractionMode}){const s=this.requireSession(input.session_id);const previous=s.extraction_mode;s.extraction_mode=input.extraction_mode;s.updated_at=now();this.store.updateSession(s);return {session:s,previous_extraction_mode:previous,server_extractor:this.extractor.name};}
  changeLearningStatus(input:{card_id:string;status:"new"|"mastered"|"review"|"ignored"}){const sessionId=this.findCardSession(input.card_id);const s=this.requireSession(sessionId);const event:CardEvent={event:"status_change",card_id:input.card_id,at_turn:`manual:${s.last_captured_turn}`,reason:"user learning status update",learning_status:input.status};this.applyEvent(sessionId,s.last_captured_turn,event);return this.store.getCard(input.card_id);}
  export(sessionId:string,format:ExportFormat){const session=this.requireSession(sessionId);const content=reconstructExport({session,turns:this.store.listTurns(sessionId),cards:this.store.listCards(sessionId,{includeInactive:true}),format});const exportId=id("export");this.store.saveExport(exportId,sessionId,format,session.last_captured_turn,content);return {export_id:exportId,format,source_cursor:session.last_captured_turn,content};}
  getCard(cardId:string){const card=this.store.getCard(cardId);if(!card)throw new Error("card not found");return {card,revisions:this.store.listRevisions(cardId)};}
  private requireSession(id:string){const s=this.store.getSession(id);if(!s)throw new Error("session not found");return s;}
  private normalizedTitle(title:string|undefined,fallback?:string):string{const normalized=title?.trim()||fallback;if(!normalized)throw new Error("session title is required");if(normalized.length>80)throw new Error("session title must be 80 characters or fewer");return normalized;}
  private findCardSession(cardId:string):string{const r=this.store.db.prepare("SELECT session_id FROM cards WHERE card_id=?").get(cardId) as {session_id:string}|undefined;if(!r)throw new Error("card not found");return r.session_id;}
}
