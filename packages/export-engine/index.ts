import type { KnowledgeCard } from "../card-protocol/index.js";
import type { Session, Turn } from "../shared/index.js";

export type ExportFormat="markdown"|"mermaid"|"json";
export interface ExportContext{session:Session;turns:Turn[];cards:KnowledgeCard[];format:ExportFormat;}
function active(cards:KnowledgeCard[]){return cards.filter(c=>c.lifecycle==="active"&&c.learning_status!=="ignored");}
function group(cards:KnowledgeCard[]){return Map.groupBy(cards,c=>c.type);}
export function reconstructExport(ctx:ExportContext):string{
  const cards=active(ctx.cards); const groups=group(cards);
  if(ctx.format==="json") return JSON.stringify({protocol_version:"1.0",session:ctx.session,source_range:{first_turn:ctx.turns[0]?.turn_id??null,last_turn:ctx.turns.at(-1)?.turn_id??null,cursor:ctx.session.last_captured_turn},turns:ctx.turns,cards},null,2);
  if(ctx.format==="mermaid"){
    const lines=["mindmap","  root((情境化学习))"];
    for(const [type,items] of groups){lines.push(`    ${type}`);for(const c of items)lines.push(`      ${c.title.replace(/[():]/g," ")}`);}
    return lines.join("\n");
  }
  const lines=[`# ${ctx.session.title} · 学习笔记`,"","> 基于完整可用会话按知识依赖重构；卡片仅用于定位证据，不按时间线拼接。","",`覆盖范围：${ctx.turns.length} 轮，真实游标 ${ctx.session.last_captured_turn}。`,""];
  const order=["framework","principle","concept","method","operation","correction","learning_debt"];
  const labels:Record<string,string>={framework:"知识框架",principle:"底层原理",concept:"核心概念",method:"方法",operation:"操作原理与验证",correction:"纠错路径",learning_debt:"待深挖"};
  for(const type of order){const items=groups.get(type as KnowledgeCard["type"]);if(!items?.length)continue;lines.push(`## ${labels[type]}`,"");for(const c of items){lines.push(`### ${c.title}`,"",c.summary,"");if(c.body.mechanism)lines.push(`- 机制：${c.body.mechanism}`);if(c.body.boundary)lines.push(`- 边界：${c.body.boundary}`);if(c.operation)lines.push(`- 实际作用：${c.operation.actual_effect}`,`- 当前目的：${c.operation.current_purpose}`,`- 验证：${c.operation.verification.join("；")}`,`- 风险：${c.operation.risks.join("；")}`,`- 可逆性：${c.operation.reversibility}`);if(c.learning_debt)lines.push(`- 问题：${c.learning_debt.question}`,`- 建议阶段：${c.learning_debt.recommended_stage}`);lines.push(`- 来源：${c.provenance.map(p=>p.turn_ref).join("、")}`,"");}}
  return lines.join("\n");
}
