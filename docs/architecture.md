# Architecture

```text
authorized completed turn
  -> adapter / MCP tool
  -> KnowledgeService
  -> session.extraction_mode
     -> host_structured: validate host AI knowledge_items
     -> server_llm: redacted turn -> configurable KnowledgeExtractor
  -> v2 protocol validation
  -> atomic lifecycle application
  -> SQLite event + revision + materialized state
  -> MCP structured result / HTTP service API
  -> MCP App view or standalone preview
  -> restricted HTTPS iframe in optional desktop companion

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
- `apps/desktop-companion`: Tauri 2 window shell; owns only window controls and embeds the production panel from the fixed HTTPS origin. It has no shell, filesystem, HTTP-client, clipboard, accessibility, or screen-capture capability.
- `adapters/*`: host config and capability notes only; shared packages import none of them.

The HTTP runtime loads a single validated configuration object. Development binds to loopback; production binds to all interfaces behind an HTTPS reverse proxy. `/health`, `/ready`, `/mcp`, and `/app/` have separate routing. MCP sessions remain process-local in M1 and are explicitly closed during graceful shutdown; durable knowledge writes remain transactional in SQLite.

`sessions.extraction_mode` is the shared source of truth for all frontends. New and migrated sessions default to `host_structured`. This avoids an unexpected provider call or fee. The panel switches the mode through a domain endpoint and never reads model credentials. In `host_structured`, active captures must include a schema-valid `knowledge_items` array; an empty array represents a completed turn with nothing worth retaining. In `server_llm`, host items are ignored and the extractor receives only the redacted persisted-turn shape.

Both model paths converge on one compact `knowledge_items` schema. The server—not an external model—assigns card IDs, provenance, revisions, and canonical event shapes. This keeps provider output small, makes schema repair practical, and prevents a model from inventing persistence identities.

The desktop companion is a presentation boundary, not a capture adapter. Its local origin can frame only `https://knowledge-copilot.xyz`; the remote panel runs in a sandboxed iframe and uses the existing service API. Conversation capture still requires an explicit MCP tool call or a supported host lifecycle hook.

## State and concurrency

`sessions.last_captured_turn` is the real monotonically increasing cursor. Turns have a unique `(session_id,idempotency_key)` and cursor. Source host turn IDs are preferred idempotency keys; otherwise a content hash is used. Card revisions are immutable; `cards` is the current materialized view. Mode-specific extraction and validation complete before the atomic turn/session/event transaction, so a provider failure neither stores a partial turn nor consumes the idempotency key or cursor.

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
