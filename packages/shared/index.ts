import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

export const captureScopeSchema = z.object({ mode: z.enum(["all", "topic"]), topic: z.string().nullable() });

export const sessionSchema = z.object({
  session_id: z.string(), title: z.string(), status: z.enum(["active", "paused", "ended"]),
  capture_scope: captureScopeSchema,
  created_at: z.string(), updated_at: z.string(), last_captured_turn: z.number().int().nonnegative(),
  source_host: z.string()
});
export const turnSchema = z.object({
  turn_id: z.string(), session_id: z.string(), user_message: z.string(), assistant_message: z.string(),
  tool_observations: z.array(z.string()), created_at: z.string(), source_reference: z.string().nullable(),
  idempotency_key: z.string(), cursor: z.number().int().positive()
});
export type Session = z.infer<typeof sessionSchema>;
export type Turn = z.infer<typeof turnSchema>;

export function id(prefix: string): string { return `${prefix}_${randomUUID()}`; }
export function now(): string { return new Date().toISOString(); }
export function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function redact(text: string): string {
  return text
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, "[REDACTED_API_KEY]")
    .replace(/((?:api[_-]?key|token|password)\s*[=:]\s*)\S+/gi, "$1[REDACTED]");
}
