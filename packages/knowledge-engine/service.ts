import { knowledgeCardSchema, type CardEvent, type KnowledgeCard } from "../card-protocol/index.js";
import { reconstructExport, type ExportFormat } from "../export-engine/index.js";
import { id, now, redact, stableHash, type ExtractionMode, type Session, type Turn } from "../shared/index.js";
import { KnowledgeStore } from "../storage/index.js";
import { modelKnowledgeItemsToEvents, type ModelKnowledgeItem } from "./model-knowledge.js";
import type { KnowledgeExtractor } from "./types.js";

export class KnowledgeService {
  constructor(readonly store:KnowledgeStore,readonly extractor:KnowledgeExtractor){}
  start(input:{title?:string;source_host?:string;capture_scope?:{mode:"all"|"topic";topic:string|null};extraction_mode?:ExtractionMode}={},ownerUserId:string|null=null):Session{
    const at=now();return this.store.createSession({session_id:id("session"),title:this.normalizedTitle(input.title,"待命名学习会话"),status:"active",capture_scope:input.capture_scope??{mode:"all",topic:null},created_at:at,updated_at:at,last_captured_turn:0,source_host:input.source_host??"unknown",extraction_mode:input.extraction_mode??"host_structured"},ownerUserId);
  }
  renameSession(input:{session_id:string;title:string},ownerUserId:string|null=null):Session{const session=this.requireSession(input.session_id,ownerUserId);session.title=this.normalizedTitle(input.title);session.updated_at=now();this.store.updateSession(session);return session;}
  launch(input:{session_id?:string;title?:string;source_host?:string;extraction_mode?:ExtractionMode}={},ownerUserId:string|null=null){const session=input.session_id?this.requireSession(input.session_id,ownerUserId):(input.source_host?this.store.findActiveSessionBySourceHost(input.source_host,ownerUserId):null)??this.start({title:input.title,source_host:input.source_host??"chatgpt",extraction_mode:input.extraction_mode},ownerUserId);return {...this.get(session.session_id,ownerUserId),capture_policy:"continuous_until_paused",next_tool:"capture_active_learning_turn" as const};}
  get(sessionId:string,ownerUserId:string|null=null){const session=this.requireSession(sessionId,ownerUserId);return {session,cursor:session.last_captured_turn,cards:this.store.listCards(sessionId,{includeInactive:true}),learning_debts:this.store.listCards(sessionId,{type:"learning_debt"})};}
  async capture(input:{session_id?:string;user_message:string;assistant_message:string;tool_observations?:string[];source_reference?:string;idempotency_key?:string;source_host?:string;knowledge_items?:ModelKnowledgeItem[]},ownerUserId:string|null=null){
    const session=input.session_id?this.requireSession(input.session_id,ownerUserId):(input.source_host?this.store.findActiveSessionBySourceHost(input.source_host,ownerUserId):null);
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
        events=modelKnowledgeItemsToEvents(turn,input.knowledge_items,activeCards);
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
  revise(input:{card_id:string;expected_revision:number;patch:Record<string,unknown>;reason:string},ownerUserId:string|null=null){const card=this.store.getCard(input.card_id);if(!card)throw new Error("card not found");if(card.revision!==input.expected_revision)throw new Error(`revision conflict: current ${card.revision}`);const sessionId=this.findCardSession(input.card_id);const session=this.requireSession(sessionId,ownerUserId);const event:CardEvent={event:"revise",card_id:card.card_id,at_turn:`manual:${session.last_captured_turn}`,reason:input.reason,patch:input.patch};this.applyEvent(sessionId,session.last_captured_turn,event);return this.store.getCard(card.card_id);}
  changeStatus(input:{session_id:string;status:"active"|"paused"|"ended";capture_scope?:{mode:"all"|"topic";topic:string|null}},ownerUserId:string|null=null){const s=this.requireSession(input.session_id,ownerUserId);const previous=s.status;s.status=input.status;if(input.capture_scope)s.capture_scope=input.capture_scope;s.updated_at=now();this.store.updateSession(s);return {session:s,previous_status:previous,resume_from_cursor:input.status==="active"?s.last_captured_turn:null};}
  changeExtractionMode(input:{session_id:string;extraction_mode:ExtractionMode},ownerUserId:string|null=null){const s=this.requireSession(input.session_id,ownerUserId);const previous=s.extraction_mode;s.extraction_mode=input.extraction_mode;s.updated_at=now();this.store.updateSession(s);return {session:s,previous_extraction_mode:previous,server_extractor:this.extractor.name};}
  changeLearningStatus(input:{card_id:string;status:"new"|"mastered"|"review"|"ignored"},ownerUserId:string|null=null){const sessionId=this.findCardSession(input.card_id);const s=this.requireSession(sessionId,ownerUserId);const event:CardEvent={event:"status_change",card_id:input.card_id,at_turn:`manual:${s.last_captured_turn}`,reason:"user learning status update",learning_status:input.status};this.applyEvent(sessionId,s.last_captured_turn,event);return this.store.getCard(input.card_id);}
  export(sessionId:string,format:ExportFormat,ownerUserId:string|null=null){const session=this.requireSession(sessionId,ownerUserId);const content=reconstructExport({session,turns:this.store.listTurns(sessionId),cards:this.store.listCards(sessionId,{includeInactive:true}),format});const exportId=id("export");this.store.saveExport(exportId,sessionId,format,session.last_captured_turn,content);return {export_id:exportId,format,source_cursor:session.last_captured_turn,content};}
  getCard(cardId:string,ownerUserId:string|null=null){const card=this.store.getCard(cardId);if(!card)throw new Error("card not found");this.requireSession(this.findCardSession(cardId),ownerUserId);return {card,revisions:this.store.listRevisions(cardId)};}
  private requireSession(id:string,ownerUserId:string|null){const s=this.store.getSession(id);if(!s||this.store.sessionOwner(id)!==ownerUserId)throw new Error("session not found");return s;}
  private normalizedTitle(title:string|undefined,fallback?:string):string{const normalized=title?.trim()||fallback;if(!normalized)throw new Error("session title is required");if(normalized.length>80)throw new Error("session title must be 80 characters or fewer");return normalized;}
  private findCardSession(cardId:string):string{const r=this.store.db.prepare("SELECT session_id FROM cards WHERE card_id=?").get(cardId) as {session_id:string}|undefined;if(!r)throw new Error("card not found");return r.session_id;}
}
