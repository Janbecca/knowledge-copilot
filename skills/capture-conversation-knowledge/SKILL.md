---
name: capture-conversation-knowledge
description: Capture and reconstruct contextual learning from an ongoing conversation while keeping the user's task primary. Use when the user @mentions Knowledge Copilot or asks to 开启/继续/暂停知识沉淀、打开笔记、记录本轮、边做边学、旁路记录知识卡片、只看新增、复盘或导出当前对话，or wants concepts, mechanisms, methods, frameworks, valuable operations, corrections, learning debt, provenance, knowledge maps, operation manuals, or study notes extracted without turning the main task into a lesson.
---

# Capture Conversation Knowledge

Treat the available conversation as source material for a learning sidecar. Keep the user's task primary; capture knowledge without turning ordinary replies into lessons or status reports.

## Honor the interaction contract

1. Answer the current task completely in the normal style.
2. Do not append “已记录”, mini-summaries, card payloads, or teaching sections to ordinary replies.
3. Do not ask setup questions when a safe default works or interrupt execution merely to fill optional knowledge fields.
4. Never claim asynchronous work, exact hidden checkpoints, persistent memory, or a native sidebar. In a plain chat, tracking is limited to the currently available context and visible artifacts.
5. Exclude private details, emotional disclosures, casual logistics, and secrets unless explicitly needed for the requested learning material. Redact credentials and sensitive values from operations.

If activation is the only request, acknowledge it in one short sentence and mention “生成本轮知识笔记”. If activation accompanies a task, perform the task without a separate tracking acknowledgment.

## Launch the real product layer when available

When Knowledge Copilot MCP tools are available and the user explicitly invokes the product by `@Knowledge Copilot` or says “开启知识沉淀”, “打开笔记”, “记录本轮”, or “知识副驾驶”:

1. Call `launch_knowledge_copilot` so the inline knowledge panel renders immediately.
2. If no session ID is active, generate a concise title from the current conversation topic and pass it as `title`; do not ask the user to name the session when context is sufficient.
3. Reuse the returned `session_id` for later captures in the same conversation.
4. When the user asks to change the title, call `rename_learning_session` and use the exact requested title, or generate a concise replacement when they ask for an improved title without specifying one.
5. After an explicit “记录本轮并打开笔记” request, capture the completed authorized turn and then call `open_knowledge_panel` with the active session ID.

Do not claim that a plain `@` mention alone is a passive transcript hook. The model must select the launch tool, and only the explicitly submitted conversation content is persisted.

## Maintain the knowledge sidecar

For each relevant exchange, identify only material that improves understanding:

- concepts, facts, distinctions, methods, standards, and frameworks;
- mechanisms, causes, constraints, trade-offs, reasoning chains, and boundaries;
- valuable operations that change or inspect device, code, data, configuration, environment, or diagnostic state;
- misconceptions, disproved hypotheses, revisions, transferable principles, and unresolved learning debt;
- provenance and confidence: user statement, conversation evidence, attached/external source, assistant inference, or unknown.

Filter social filler, duplicate output, repeated logs, progress animation, and mechanical retries that add no evidence. Do not filter an operation merely because it is an execution detail. For valuable operations, model `operation → actual effect → current purpose → mechanism → prerequisites → verification → risk → reversibility`; distinguish read-only inspection from mutation and state when no persistent change occurs.

Maintain cards conceptually using `add`, `merge`, `revise`, `supersede`, and `discard`. A later supported conclusion must revise or supersede a conflicting card rather than coexist as another fact. Preserve a correction path only when it teaches a reusable diagnostic lesson. Put worthwhile but disruptive questions into learning debt instead of expanding them in the main reply.

When an external state/UI consumer or the user explicitly requests card data, emit the protocol in [knowledge-card-protocol.md](references/knowledge-card-protocol.md). Otherwise keep cards out of the visible main response.

## Interpret controls honestly

- “暂停沉淀”: stop deriving new cards after the visible pause boundary; keep answering the task.
- “继续沉淀”: resume from the visible resume boundary; do not claim recovery of unrecorded material.
- “只沉淀这个话题”: narrow subsequent capture and export scope.
- “只看新增”: compare against an explicit state-store cursor when available; otherwise use the last visible card/export boundary and disclose that limitation briefly.
- “标记已掌握/待复习/忽略”: emit or apply a status update only when a state consumer exists; in plain chat, treat it as a visible instruction for the current context.
- “清空重新开始”: reset the conceptual working set for later outputs; do not claim to delete chat history or external data.
- “结束并导出”: reconstruct, export, then stop deriving new cards.

## Reconstruct exports from the conversation

When asked for notes, a map, manual, review, or export:

1. Resolve scope and output type; default to the available current conversation and standard learning notes.
2. Re-read all available conversation context. Disclose only real coverage gaps such as missing or compacted earlier turns.
3. Treat cards as an index, not the final document. Never concatenate them chronologically.
4. Cluster by knowledge dependency; deduplicate, normalize terms, and restore complete processes and causal links.
5. Prefer the latest well-supported conclusion. Preserve an earlier error only when its correction is pedagogically useful.
6. Separate general principles from current-case specifics and label user judgments, external facts, assistant inference, and unverified claims where it affects trust.
7. Add connective reasoning only when supported; label new deductions. Do not invent sources or certainty.
8. Produce material that can be read without the original chat.

Select the smallest useful output: quick review, standard notes, deep study pack, or map-focused export. For product implementation or integration work, consult [product-layer.md](references/product-layer.md) and [acceptance-scenarios.md](references/acceptance-scenarios.md).

## Verify quality

Before returning a card update or export, verify:

- the main task remained primary;
- execution noise was removed but state-changing or diagnostically useful operations survived;
- conflicting claims were revised or superseded with traceable sources;
- each major conclusion has a mechanism, evidence trail, or explicit uncertainty;
- no behavior implies a background process, durable store, or sidebar unless a real product layer supplies it.
