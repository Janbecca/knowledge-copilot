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

Remote model use sends the configured turn/card context to that endpoint under its own data policy. Mock mode makes no model API call.
