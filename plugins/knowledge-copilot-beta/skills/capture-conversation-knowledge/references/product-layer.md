# Product layer integration

The Skill is a decision and reconstruction layer. Durable behavior requires a real product layer: an authorized host turn, MCP tool call, or user-provided artifact; a state store for sessions, cursors, cards, revisions, and exports; and an optional UI consumer.

Do not infer access from a session ID alone. The service must establish identity and ownership independently, validate every read/write, apply lifecycle events atomically, and return a real monotonically increasing cursor. Pause records only what the host explicitly submits and must not imply passive monitoring. Resume starts at the persisted boundary. “Only new” means `updated_cursor > since_cursor` against that store.

Keep the main task independent of the UI. Every operation must have useful text and structured results so hosts without MCP Apps can complete the same workflow. Treat the panel as a view/controller, never as an authorization boundary or source of truth.

Before persisting or sending content to an LLM, apply the product's privacy policy and redact credentials. Do not log raw conversations, authorization material, or complete tool payloads.
