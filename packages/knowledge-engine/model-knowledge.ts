import { z } from "zod";
import type { CardEvent, KnowledgeCard } from "../card-protocol/index.js";
import { id, redact, type Turn } from "../shared/index.js";

export const knowledgeItemSchema = z.object({
  type: z.enum(["concept", "principle", "method", "operation", "framework", "correction", "learning_debt"]),
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(1200),
  mechanism: z.string().max(1200).optional(),
  reasoning_chain: z.array(z.string().max(500)).max(8).optional(),
  boundary: z.string().max(800).optional(),
  transfer: z.array(z.string().max(500)).max(8).optional(),
  tags: z.array(z.string().max(60)).max(12).optional(),
  confidence: z.enum(["high", "medium", "low", "unknown"]).optional(),
});

export const knowledgeItemsResponseSchema = z.object({ knowledge_items: z.array(knowledgeItemSchema).max(8) });
export type ModelKnowledgeItem = z.infer<typeof knowledgeItemSchema>;

export function modelKnowledgeItemsToEvents(turn: Turn, items: ModelKnowledgeItem[], active: KnowledgeCard[]): CardEvent[] {
  return items.flatMap((item): CardEvent[] => {
    const title = redact(item.title.trim());
    const summary = redact(item.summary.trim());
    if (!title || !summary) return [];
    const body = {
      definition_or_claim: summary,
      mechanism: item.mechanism ? redact(item.mechanism) : null,
      reasoning_chain: (item.reasoning_chain ?? []).map(redact),
      boundary: item.boundary ? redact(item.boundary) : null,
      transfer: (item.transfer ?? []).map(redact),
    };
    const tags = [...new Set((item.tags ?? []).map(tag => redact(tag.trim())).filter(Boolean))];
    const existing = active.find(card => card.lifecycle === "active" && card.title.trim().toLocaleLowerCase() === title.toLocaleLowerCase());
    if (existing) {
      if (existing.summary === summary && JSON.stringify(existing.body) === JSON.stringify(body)) return [];
      return [{ event: "revise", card_id: existing.card_id, at_turn: turn.turn_id, reason: "updated by a later completed conversation turn", patch: { summary, body, tags: [...new Set([...existing.tags, ...tags])], confidence: item.confidence ?? "medium", evidence_status: "inferred" } }];
    }
    const card: KnowledgeCard = {
      card_id: id("card"), revision: 1, type: item.type, title, summary, body, operation: null,
      learning_debt: item.type === "learning_debt" ? { question: title, origin: turn.turn_id, learning_value: summary, task_relation: "Captured from the active conversation for later study.", recommended_stage: "after_task" } : null,
      provenance: [{ turn_ref: turn.turn_id, speaker: "assistant", kind: "inference", excerpt: summary }],
      confidence: item.confidence ?? "medium", evidence_status: "inferred", learning_status: "new", lifecycle: "active",
      supersedes: [], created_at_turn: turn.turn_id, updated_at_turn: turn.turn_id, tags,
    };
    return [{ event: "add", card_id: card.card_id, at_turn: turn.turn_id, reason: "knowledge distilled from a completed turn", card }];
  });
}
