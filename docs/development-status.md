# Development status

Last updated: 2026-08-29

## Current objective

Build the secure cross-host desktop workflow agreed on 2026-08-29:

- invoking Knowledge Copilot wakes the draggable desktop cockpit or shows an installation guide;
- the user chooses `host_structured` or `server_llm` in the shared cockpit;
- only explicitly authorized conversation content is captured;
- owned sessions and learned knowledge remain available across ChatGPT, Claude Code, Codex, WorkBuddy, web, and desktop;
- account, device, consent, pause/stop, and revocation controls precede automatic host capture.

The approved security and consent contract is in `docs/security-and-consent.md`. Production identity will use a standards-based external OAuth/OIDC provider (Auth0 is the first deployment target), while the service implements resource-server validation and ownership enforcement.

### Secure desktop delivery progress

- [x] Product trust boundaries, adapter priority, consent defaults, ownership rules, and wake-token design documented.
- [x] OIDC resource-server verification and protected-resource metadata.
- [x] User/session ownership, paired device, consent grant, and audit persistence.
- [x] Short-lived single-use wake-token API.
- [x] Tauri custom protocol, secure device storage, capture indicator, and install fallback.
- [ ] ChatGPT per-conversation browser extension and native messaging. Code, narrow permissions, native bridge, backend consent enforcement, and development registration script are complete; real Chrome UI acceptance and a fixed store extension ID remain.
- [x] Official-interface-first Claude Code hook bridge and Codex MCP/skill contract.
- [ ] WorkBuddy continuous lifecycle adapter (blocked on verification of an official host API; MCP tool flow remains available).
- [x] Account/device/consent UI and signed-auth integration coverage.
- [ ] Production OIDC configuration, deployment, and real-host acceptance.

### Security constraints

- Capture is off by default and never expands across hosts or conversations silently.
- No global screen, keyboard, clipboard, password-field, or unrelated-window monitoring.
- Windows UI Automation remains a separately reviewed optional fallback, not an initial capture mechanism.
- Deep links carry only short-lived one-time wake tokens, never conversation text or durable credentials.
- Production multi-user capture stays disabled until OIDC and ownership enforcement are deployed.

## Existing extraction objective

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
- `npm test`: 13 test files, 36/36 tests passed on 2026-08-29.
- `npm run build`: panel, desktop UI, and TypeScript production build passed; final panel output 282.21 kB (69.22 kB gzip).
- Real Playwright browser flow: created a `server_llm` session, switched it to `host_structured`, submitted a structured knowledge item, and observed cursor `0 -> 1` plus a rendered card.
- `npm run verify:plugin`: passed for final and Beta standalone package copies.
- `npm run test:mcp`: passed with 15 tools, declared contracts, cursor 1, and an operation card.
- Secure identity verification on 2026-08-29: 13 test files and 36/36 tests passed, including signed RS256 JWT/JWKS validation, 401/403 handling, cross-owner 404 isolation, device pairing/revocation, consent revocation, one-time wake consumption, and replay rejection.
- Desktop wake verification on 2026-08-29: TypeScript typecheck passed; Vite desktop UI build passed; native `cargo check` passed with Tauri deep-link + single-instance, Windows credential manager, and HTTPS wake consumption.
- Desktop installer on 2026-08-29: unsigned NSIS package rebuilt successfully with the native host and Claude hook bridge at `apps/desktop-companion/src-tauri/target/release/bundle/nsis/Knowledge Copilot_0.1.0_x64-setup.exe` (2,870,741 bytes). Code signing and automatic Native Messaging manifest registration remain release work.
- ChatGPT adapter on 2026-08-29: Manifest V3 scripts pass JavaScript syntax validation; permissions are limited to `storage`, `nativeMessaging`, and `https://chatgpt.com/*`; device capture without matching per-conversation consent returns 403 in the signed OIDC HTTP integration test.
- Claude Code adapter on 2026-08-29: official `UserPromptSubmit`, `Stop`, and `SessionEnd` command-hook bridge implemented; JavaScript syntax and native Rust bridge compilation passed. `server_llm` forwards completed turns, while `host_structured` feeds a scoped instruction back to Claude to call the MCP structured-capture tool.
- Final repository verification on 2026-08-29: repository policy, TypeScript typecheck, 13 test files/36 tests, panel + desktop UI + server build, standalone plugin packaging, and the 16-tool MCP smoke contract all passed in one `npm run verify` run.
- Local Windows acceptance on 2026-08-29: the rebuilt NSIS package installed successfully to `D:\Knowledge Copilot` and launched the `Knowledge Copilot` desktop window. Chrome's protected `chrome://extensions` surface cannot be automated by the browser-control policy, so unpacked-extension loading and collection of the generated extension ID require a one-time user handoff before the Native Messaging registry entry can be installed.

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
