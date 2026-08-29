# Privacy and data

## Current local boundary

- Default database: `./data/knowledge-copilot.sqlite`.
- Stored: session metadata, submitted user/assistant messages, submitted tool observations, source references, cards, provenance, revision events, exports.
- Not passively collected: turns the host/user did not submit.
- Not intentionally stored: API keys. Environment variables configure model access.
- Basic redaction replaces common `sk-*`, API key, token, and password patterns before turn persistence.

## Limitations

Basic pattern redaction cannot recognize every secret or personal datum. SQLite is not application-level encrypted. The local HTTP preview binds only to `127.0.0.1` but has no user authentication. These defaults are suitable for a local MVP, not a multi-user or internet deployment.

## Production requirements

- authenticated users and tenant isolation;
- encryption at rest and managed secret storage;
- explicit retention/deletion controls for sessions, turns, cards, revisions, and exports;
- structured secret scanning before storage and before LLM calls;
- consent and least-privilege source access;
- audit logging without raw sensitive payloads;
- CSP/origin/auth controls for remote MCP and app resources.

`host_structured` mode makes no second server-side model call: the host AI submits schema-valid knowledge items, and the server validates and saves them. `server_llm` mode sends the redacted completed turn and active-card context to the configured provider under that provider's data policy. Switching modes never exposes the provider API key to the browser. Mock extractor configuration makes no external model API call.
