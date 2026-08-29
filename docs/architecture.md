# Architecture

```text
authenticated user + paired device + explicit consent
  -> authorized completed turn
  -> host adapter / MCP tool / desktop local agent
  -> ownership and replay checks
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
- `apps/desktop-companion`: Tauri 2 window shell evolving into a narrowly scoped local agent. Phase 1 adds a custom wake protocol, secure device identity, visible capture controls, and adapter messaging. It still has no global keyboard, clipboard, accessibility, or screen-capture permission.
- `adapters/*`: host config and capability notes only; shared packages import none of them.

Identity, ownership, device pairing, consent, and wake-token invariants are specified in `docs/security-and-consent.md`. Authentication is an HTTP/MCP boundary concern; the knowledge engine remains host-neutral but all externally reachable session operations receive an authenticated owner context when auth mode is enabled.

The HTTP runtime loads a single validated configuration object. Development binds to loopback; production binds to all interfaces behind an HTTPS reverse proxy. `/health`, `/ready`, `/mcp`, and `/app/` have separate routing. MCP sessions remain process-local in M1 and are explicitly closed during graceful shutdown; durable knowledge writes remain transactional in SQLite.

`sessions.extraction_mode` is the shared source of truth for all frontends. New and migrated sessions default to `host_structured`. This avoids an unexpected provider call or fee. The panel switches the mode through a domain endpoint and never reads model credentials. In `host_structured`, active captures must include a schema-valid `knowledge_items` array; an empty array represents a completed turn with nothing worth retaining. In `server_llm`, host items are ignored and the extractor receives only the redacted persisted-turn shape.

Both model paths converge on one compact `knowledge_items` schema. The server—not an external model—assigns card IDs, provenance, revisions, and canonical event shapes. This keeps provider output small, makes schema repair practical, and prevents a model from inventing persistence identities.

The desktop companion is both a presentation boundary and, after explicit pairing, a local routing agent. Its remote panel remains restricted to `https://knowledge-copilot.xyz`. It accepts only signed, single-use wake intents and data from approved host adapters. Conversation capture still requires an explicit host lifecycle/tool event or a per-conversation browser-extension grant; merely having the companion open never authorizes window reading.

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
