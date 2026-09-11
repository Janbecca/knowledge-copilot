# Testing

## Commands

```powershell
npm.cmd run db:init
npm.cmd run typecheck
npm.cmd run test:unit
npm.cmd run test:integration
npm.cmd test
npm.cmd run build
npm.cmd run verify:repository
npm.cmd run verify:plugin
npm.cmd run test:mcp
npm.cmd run demo
```

Runtime checks:

```powershell
npm.cmd start
Invoke-RestMethod http://127.0.0.1:3210/health
```

Open `http://127.0.0.1:3210/app/` to verify the built panel against the same service state.

## Coverage mapping

| Requirement | Test/evidence |
|---|---|
| Short-video framework | `scenarios.test.ts` |
| ESP32 operation model/noise | `protocol.test.ts` |
| Wrong conclusion superseded | `lifecycle.test.ts`, export integration |
| Pause/resume/only-new | `scenarios.test.ts` real cursors |
| Novel Excel domain | `scenarios.test.ts` |
| Duplicate turn idempotency | `scenarios.test.ts` |
| SQLite restart persistence | `persistence.test.ts` |
| No API key / mock | all tests plus demo |
| UI lifecycle distinctions | `ui-contract.test.ts` plus preview |
| Non-timeline export | export assertions and reconstructed heading order |
| MCP annotations/output schemas/errors | `mcp-contract.test.ts` plus SDK smoke |
| Dual extraction routing and retry atomicity | `extraction-mode.test.ts` |
| LLM request contract, bounded repair, and sanitized HTTP errors | `llm-extractor.test.ts` |
| UI mode switch and HTTP endpoint | `ui-contract.test.ts`, `http-runtime.test.ts` |
| Three ChatGPT conversations × ten alternating turns | `http-auth.test.ts` owner-scoped binding acceptance |
| Concurrent offline tabs, durable retry and deduplication | `chatgpt-extension-background.test.ts` 30-turn queue acceptance |

## ChatGPT Web P0 live acceptance

Automated tests prove routing, ownership, idempotency and retry behavior, but cannot prove compatibility with ChatGPT's current production DOM or Chrome's installation UI. Run this checklist using a Web Store test release and a desktop build compiled with the same fixed extension ID:

1. Install the desktop app on a Windows user profile that has no prior Knowledge Copilot credentials or registry entries.
2. Complete system-browser login and confirm the app returns automatically without a manual “登录完成” step.
3. Install the Chrome extension from its test listing and confirm the desktop app reports the actual version and browser after the Native Messaging heartbeat.
4. Open ChatGPT conversations A, B and C. Confirm none of their message text is sent before separately accepting “从现在开始沉淀”.
5. Enable A, produce ten completed user/assistant turns, and verify the desktop cursor reaches ten without duplicates.
6. Alternate A → B → C repeatedly. Verify the desktop title/session changes to the foreground enabled conversation and collapses on an unenabled conversation.
7. Disconnect the network, complete at least two turns in each enabled conversation, and confirm the extension reports that the turns are safely queued.
8. Restore the network and desktop app. Verify all six turns arrive once, remain in their original sessions, and the local queue becomes empty.
9. Pause B and verify new B turns are not captured; resume it and verify capture continues from the prior cursor. End C and verify its history remains readable while new capture stays off.
10. Restart Chrome and Windows, reopen A, and verify the existing binding and knowledge history are restored.

Record the desktop version, extension version/ID, Chrome version, ChatGPT URL shape, timestamps, three session IDs, final cursors, screenshots, and any failed step. A local or mocked pass must not be recorded as this live acceptance.

Do not treat source inspection as runtime proof. Record actual command results here after every verification pass. External product-host testing remains separate from local server and browser-preview testing.

## Verified on 2026-08-29

- TypeScript typecheck: passed.
- Full test run: 10 files, 29/29 tests passed.
- Dual-mode tests: host mode bypasses server extractor; server mode invokes it; provider failure preserves cursor/idempotency retry; mode change persists.
- Production build: panel, desktop UI, and server TypeScript passed.
- Playwright browser flow: created in server mode, switched to host mode, directly saved a structured concept, and observed cursor 1/card rendering.
- Plugin package validation passed; MCP stdio smoke discovered 15 tools and completed a server-mode capture at cursor 1.
- DeepSeek contract fix: 11 test files, 32/32 tests, production build, and 15-tool MCP smoke passed.

## Previous verification: 2026-08-25

- `typecheck`: passed.
- Unit tests: 3/3 passed.
- Integration tests: 7/7 passed.
- Full test run: 18/18 passed.
- Panel build: 133 modules transformed; single-file `index.html` 276.49 kB (67.23 kB gzip).
- Database initialization: created/opened `./data/knowledge-copilot.sqlite` and applied migration 1.
- Mock demo: session cursor 1, persisted ESP32 operation card, reconstructed Markdown output.
- MCP SDK stdio smoke: 11 tools discovered; create/capture/get returned cursor 1 and an operation card; UI tool present.
- MCP contract suite: all 11 tools declare output schemas and closed-world risk annotations; positive, empty, idempotent, invalid-input, conflict, not-found, and sanitized internal-error paths passed.
- Repository policy check: no committable secret, `.env`, or SQLite artifact found.
- Plugin package check: final and Beta Skill copies are identical; all relative Markdown and manifest references resolve after standalone copying.
- HTTP/preview smoke: health returned `ok=true`, capture returned cursor 1, state returned one card, panel returned 276,216 bytes containing the Chinese panel title.
- Deployable HTTP tests: production/local bind defaults, readiness, app redirect, challenge, CORS, request size and rate-limit behavior passed.
- GitHub Actions: Node.js 22.x and 24.x verification passed; Linux Docker image built and its running `/ready` endpoint passed.
- Live ChatGPT/Codex, Claude, and WorkBuddy product installation: not performed; adapter status remains unverified.
