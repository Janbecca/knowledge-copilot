import { z } from "zod";

export const cardTypes = ["concept", "principle", "method", "operation", "framework", "correction", "learning_debt"] as const;
export const eventTypes = ["add", "merge", "revise", "supersede", "discard", "status_change"] as const;

export const provenanceSchema = z.object({
  turn_ref: z.string(),
  speaker: z.enum(["user", "assistant", "tool", "attachment", "external_source"]),
  kind: z.enum(["statement", "observation", "result", "citation", "inference"]),
  source_ref: z.string().nullable().optional(),
  excerpt: z.string().nullable().optional()
});

export const operationSchema = z.object({
  command_or_action: z.string(),
  mode: z.enum(["read_only", "mutating", "mixed", "unknown"]),
  actual_effect: z.string(),
  current_purpose: z.string(),
  mechanism: z.string(),
  prerequisites: z.array(z.string()),
  state_before: z.string().nullable().optional(),
  state_after: z.string().nullable().optional(),
  verification: z.array(z.string()),
  risks: z.array(z.string()),
  reversibility: z.enum(["reversible", "partly_reversible", "irreversible", "not_applicable", "unknown"])
});

export const learningDebtSchema = z.object({
  question: z.string(),
  origin: z.string(),
  learning_value: z.string(),
  task_relation: z.string(),
  recommended_stage: z.enum(["after_step", "after_task", "before_next_attempt", "review_session"])
});

export const knowledgeCardSchema = z.object({
  card_id: z.string(),
  revision: z.number().int().positive(),
  type: z.enum(cardTypes),
  title: z.string(),
  summary: z.string(),
  body: z.object({
    definition_or_claim: z.string().nullable().optional(),
    mechanism: z.string().nullable().optional(),
    reasoning_chain: z.array(z.string()).default([]),
    boundary: z.string().nullable().optional(),
    transfer: z.array(z.string()).default([])
  }),
  operation: operationSchema.nullable().optional(),
  learning_debt: learningDebtSchema.nullable().optional(),
  provenance: z.array(provenanceSchema),
  confidence: z.enum(["high", "medium", "low", "unknown"]),
  evidence_status: z.enum(["supported", "inferred", "disputed", "superseded", "unverified"]),
  learning_status: z.enum(["new", "mastered", "review", "ignored"]),
  lifecycle: z.enum(["active", "superseded", "discarded"]),
  supersedes: z.array(z.string()),
  created_at_turn: z.string(),
  updated_at_turn: z.string(),
  tags: z.array(z.string())
});

export const cardEventSchema = z.object({
  event: z.enum(eventTypes),
  card_id: z.string(),
  at_turn: z.string(),
  reason: z.string(),
  card: knowledgeCardSchema.optional(),
  patch: z.record(z.unknown()).optional(),
  merged_card_ids: z.array(z.string()).optional(),
  replacement_card_id: z.string().optional(),
  learning_status: z.enum(["new", "mastered", "review", "ignored"]).optional()
});

export const extractionResultSchema = z.object({ events: z.array(cardEventSchema) });

export type KnowledgeCard = z.infer<typeof knowledgeCardSchema>;
export type CardEvent = z.infer<typeof cardEventSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

export const PROTOCOL_VERSION = "1.0";
