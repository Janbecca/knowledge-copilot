# Development status

Last updated: 2026-08-29

## Current objective

Ship two extraction paths that coexist in every panel and can be switched per learning session:

- `host_structured`: the AI currently answering the user distills validated `knowledge_items`; the server stores them without a second model call.
- `server_llm`: the server sends the redacted completed turn to the configured OpenAI-compatible extractor and stores schema-valid events.

The selected mode is persisted on the session, so ChatGPT MCP Apps, the standalone web panel, and the Windows desktop companion share one setting.

## Decisions and invariants

- Default existing and new sessions to `host_structured` to avoid surprise API spend or third-party disclosure.
- The UI may switch modes, but it never receives or edits the server API key.
- `host_structured` requires `knowledge_items` for an active capture; an empty array is valid for a substantive-free turn.
- `server_llm` ignores host-supplied items and re-extracts from the redacted turn.
- Extraction must succeed before the turn/cursor is committed. Failed LLM calls must remain retryable with the same idempotency key.
- Secrets are deployment-only. Never write real keys into Git, docs, tests, logs, screenshots, or command output.

## Implementation map

- Shared contract: `packages/shared/index.ts`
- SQLite migration and mapping: `packages/storage/migrations.ts`, `packages/storage/index.ts`
- Mode routing and atomic capture: `packages/knowledge-engine/service.ts`
- MCP and HTTP mode endpoints: `mcp-server/server.ts`, `mcp-server/http.ts`
- Panel mode switch and mode-specific debug form: `apps/knowledge-panel/src/main.ts`
- Production environment pass-through: `compose.yaml`, `.env.example`

## Progress

- [x] Architecture and privacy boundary agreed.
- [x] Persistence and service routing implemented.
- [x] MCP and HTTP switching contracts implemented.
- [x] Panel UI implemented with persisted mode switching and mode-specific debug capture.
- [x] Automated tests and core developer/deployment/privacy docs updated.
- [ ] DeepSeek configured on the server and end-to-end verified.

## Verification record

- `npm run typecheck`: passed on 2026-08-29.
- `npm test`: 10 test files, 29/29 tests passed on 2026-08-29.
- `npm run build`: panel, desktop UI, and TypeScript production build passed; final panel output 282.21 kB (69.22 kB gzip).
- Real Playwright browser flow: created a `server_llm` session, switched it to `host_structured`, submitted a structured knowledge item, and observed cursor `0 -> 1` plus a rendered card.
- `npm run verify:plugin`: passed for final and Beta standalone package copies.
- `npm run test:mcp`: passed with 15 tools, declared contracts, cursor 1, and an operation card.

## Live DeepSeek follow-up

- Production credentials and `deepseek-v4-flash` were accepted by `GET /models`; the key was injected only through hidden SSH input.
- The first live capture returned 504 because the old extractor asked for a full card-event schema without actually including that schema. DeepSeek returned a valid JSON object with the wrong event shape, triggering repair attempts behind Caddy's 30-second header timeout.
- Fix in progress on `fix/deepseek-structured-output`: ask the model for the same compact, validated `knowledge_items` contract used by host mode, then let the trusted server map items to canonical IDs, provenance, add/revise events, and cards. Output is capped at 1600 tokens and active-card context is minimized.
- Fix verification: typecheck passed; 11 test files and 32/32 tests passed; production build and 15-tool MCP smoke passed.
- Added dedicated coverage for routing, no-extra-call host mode, server-mode precedence, retry atomicity, persisted mode switching, HTTP switching, and panel controls.

## Deployment target

- Public origin: `https://knowledge-copilot.xyz`
- Provider: DeepSeek-compatible OpenAI API
- Base URL and model are non-secret deployment configuration.
- API key is stored only in the server-side environment file and injected into the app container.
