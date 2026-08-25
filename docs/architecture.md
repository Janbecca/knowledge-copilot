# Architecture

```text
authorized completed turn
  -> adapter / MCP tool
  -> KnowledgeService
  -> KnowledgeExtractor (mock or configurable LLM)
  -> v2 protocol validation
  -> atomic lifecycle application
  -> SQLite event + revision + materialized state
  -> MCP structured result / HTTP service API
  -> MCP App view or standalone preview

full persisted turns
  -> ExportEngine reconstruction
  -> Markdown / Mermaid / JSON
```

## Package boundaries

- `packages/card-protocol`: sole executable schema for v2 protocol 1.0.
- `packages/knowledge-engine`: host-neutral extractor interface and lifecycle service.
- `packages/storage`: SQLite initialization/migration and persistence.
- `packages/export-engine`: reconstructs from complete turns; cards are evidence indexes.
- `packages/shared`: shared Session/Turn schema, IDs, hashing, redaction.
- `mcp-server`: transport and tool/resource registration only.
- `apps/knowledge-panel`: MCP Apps View plus standalone preview; uses tools/service HTTP, never SQLite.
- `adapters/*`: host config and capability notes only; shared packages import none of them.

## State and concurrency

`sessions.last_captured_turn` is the real monotonically increasing cursor. Turns have a unique `(session_id,idempotency_key)` and cursor. Source host turn IDs are preferred idempotency keys; otherwise a content hash is used. Card revisions are immutable; `cards` is the current materialized view. LLM extraction is validated before an atomic event transaction.

Pause still records explicitly submitted turns and advances the real boundary, but emits no card events. Resume returns that persisted cursor. “Only new” queries use `updated_cursor > since_cursor`.

## Lifecycle mapping

- `add`: inserts card revision 1.
- `revise`: optimistic/manual or extractor patch, increments revision.
- `merge`: retains one identity/provenance and discards merged identities.
- `supersede`: marks old conclusion superseded and creates linked replacement.
- `discard`: keeps history while excluding the card from active knowledge.
- `status_change`: changes learning state without pretending the knowledge claim changed.

## Export rule

The export engine receives all available persisted turns and current/historical cards. It groups by conceptual type/dependency and excludes inactive contradictions. It explicitly does not order headings by event time. A future LLM reconstruction implementation can replace the deterministic exporter through the same boundary, but must retain source range and schema validation.
