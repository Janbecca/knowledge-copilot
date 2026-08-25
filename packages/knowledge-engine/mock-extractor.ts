import type { CardEvent, KnowledgeCard } from "../card-protocol/index.js";
import { id } from "../shared/index.js";
import type { ExtractionContext, KnowledgeExtractor } from "./types.js";

function card(context: ExtractionContext, input: Partial<KnowledgeCard> & Pick<KnowledgeCard,"type"|"title"|"summary">): KnowledgeCard {
  const turn = context.turn.turn_id;
  return {
    card_id: input.card_id ?? id("card"), revision: input.revision ?? 1, type: input.type,
    title: input.title, summary: input.summary,
    body: input.body ?? { definition_or_claim: input.summary, mechanism: null, reasoning_chain: [], boundary: null, transfer: [] },
    operation: input.operation ?? null, learning_debt: input.learning_debt ?? null,
    provenance: input.provenance ?? [{ turn_ref: turn, speaker: "assistant", kind: "statement", excerpt: input.summary }],
    confidence: input.confidence ?? "medium", evidence_status: input.evidence_status ?? "supported",
    learning_status: input.learning_status ?? "new", lifecycle: input.lifecycle ?? "active",
    supersedes: input.supersedes ?? [], created_at_turn: input.created_at_turn ?? turn,
    updated_at_turn: turn, tags: input.tags ?? []
  };
}
function add(c: KnowledgeCard, turn:string, reason="new knowledge from completed turn"): CardEvent { return {event:"add",card_id:c.card_id,at_turn:turn,reason,card:c}; }

export class MockKnowledgeExtractor implements KnowledgeExtractor {
  readonly name = "mock";
  async extract(context: ExtractionContext) {
    const text = `${context.turn.user_message}\n${context.turn.assistant_message}\n${context.turn.tool_observations.join("\n")}`;
    const lower = text.toLowerCase(); const events: CardEvent[] = []; const turn=context.turn.turn_id;
    const active = context.activeCards;
    const has = (tag:string) => active.find(c => c.tags.includes(tag));

    if (/钩子|hook|完播率/.test(lower) && !has("hook")) {
      events.push(add(card(context,{type:"principle",title:"开场钩子降低继续观看的决策成本",summary:"有效钩子快速建立受众、收益与悬念，使观众有理由继续观看。",body:{definition_or_claim:"钩子不是夸张句，而是首屏价值承诺。",mechanism:"注意力稀缺时，明确收益和信息缺口会提高继续观看意愿。",reasoning_chain:["识别受众","承诺收益","制造可兑现的信息缺口"],boundary:"承诺必须与正文兑现，否则损害信任。",transfer:["标题与演讲开场也可用同一机制，并用留存或点击验证。"]},tags:["hook","content"]}),turn));
    }
    if (/个人\s*ip|情绪曲线|脚本结构/.test(lower) && !has("content-framework")) {
      events.push(add(card(context,{type:"framework",title:"短视频脚本与个人 IP 框架",summary:"脚本结构负责推进理解，情绪曲线负责维持注意，IP定位负责形成稳定预期。",tags:["content-framework","content"]}),turn));
    }
    if (/esptool|read[-_ ]?flash|flash_id|chip_id/.test(lower)) {
      const isRead=/read[-_ ]?flash|flash_id|chip_id/.test(lower); const command=(text.match(/(?:esptool[^\r\n]*)/i)?.[0] ?? "ESP32 flash operation").slice(0,240);
      const title=/read[-_ ]?flash/.test(lower)?"读取 ESP32 Flash 备份":"识别 ESP32 芯片与 Flash";
      if(!has(title)) events.push(add(card(context,{type:"operation",title,summary:isRead?"读取操作不会改写设备 Flash；read-flash 会在本地创建备份文件。":"识别步骤读取设备信息，不产生持久设备变更。",operation:{command_or_action:command,mode:isRead?"read_only":"unknown",actual_effect:/read[-_ ]?flash/.test(lower)?"设备 Flash 保持不变；本地备份文件被创建或覆盖。":"读取识别信息；没有证据表明设备持久状态改变。",current_purpose:"确认设备并为恢复保留固件副本。",mechanism:"esptool 通过串口 bootloader 协议读取芯片或 SPI Flash 数据。",prerequisites:["稳定串口连接","正确端口与读取范围","足够磁盘空间"],state_before:"设备已进入可通信状态",state_after:/read[-_ ]?flash/.test(lower)?"设备内容不变，本地存在候选备份文件":"设备内容不变，获得识别信息",verification:["检查退出码与文件大小","计算哈希；必要时二次读取并比较"],risks:["端口或长度错误会得到不完整备份","目标路径可能覆盖已有文件"],reversibility:"not_applicable"},tags:[title,"hardware"]}),turn));
    }
    const network=has("network-hypothesis");
    if(/网络.*(故障|失败)|network failure/.test(lower) && !network) events.push(add(card(context,{type:"correction",title:"故障假设：网络不可达",summary:"当前仅是假设，需要用连通性测试区分网络与上层协议问题。",confidence:"low",evidence_status:"unverified",tags:["network-hypothesis","troubleshooting"]}),turn));
    if(network && /(连接测试.*通过|connection test.*pass|tls|证书.*时间|clock)/.test(lower)) {
      const replacement=card(context,{type:"correction",title:"TLS 失败源于系统时钟异常",summary:"基础连接通过而证书时间校验失败，支持时钟导致 TLS 验证失败的结论。",confidence:"high",supersedes:[network.card_id],tags:["tls-clock","troubleshooting"]});
      events.push({event:"supersede",card_id:network.card_id,at_turn:turn,reason:"later discriminating tests disproved network reachability and supported clock/TLS cause",replacement_card_id:replacement.card_id,card:replacement});
    }
    if(/更深入|以后.*理解|待深挖|why|为什么.*以后/.test(lower) && !has("learning-debt")) {
      events.push(add(card(context,{type:"learning_debt",title:"待深挖：底层机制",summary:"该机制值得在主任务结束后系统学习。",learning_debt:{question:"当前方法依赖的底层机制是什么？",origin:turn,learning_value:"理解机制有助于迁移与排错。",task_relation:"不影响当前交付，但影响长期复用。",recommended_stage:"after_task"},tags:["learning-debt"]}),turn));
    }
    if(/excel|数据透视|面试方案|interview/.test(lower) && !has("novel-domain")) events.push(add(card(context,{type:"method",title:/excel/.test(lower)?"Excel 分析先定义问题再选工具":"面试方案以能力证据为核心",summary:/excel/.test(lower)?"先明确指标、粒度和数据质量，再选择公式、透视表或查询工具。":"把岗位能力拆为可观察行为，并用结构化问题和评分锚点收集证据。",tags:["novel-domain"]}),turn));
    if(/修订[:：]/.test(text) && active[0]) {
      const existing=active[0]; events.push({event:"revise",card_id:existing.card_id,at_turn:turn,reason:"explicit mock revision fixture",patch:{summary:`${existing.summary}（已根据新证据修订）`}});
    }
    if(/合并[:：]/.test(text) && active.length>=2) events.push({event:"merge",card_id:active[0]!.card_id,at_turn:turn,reason:"explicit mock merge fixture",merged_card_ids:[active[1]!.card_id]});
    if(/废弃[:：]/.test(text) && active[0]) events.push({event:"discard",card_id:active[0].card_id,at_turn:turn,reason:"explicit mock discard fixture"});
    return {events};
  }
}
