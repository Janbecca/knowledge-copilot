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
