# Claude adapter

Claude Code uses two official integration points together:

- MCP tools start/rename sessions, choose `host_structured` or `server_llm`, wake the desktop companion, and save structured knowledge.
- `UserPromptSubmit`, `Stop`, and `SessionEnd` command hooks maintain explicit per-session consent and forward completed turns through the paired desktop bridge.

## Install for Claude Code

1. Install and pair the Knowledge Copilot desktop companion.
2. Add the MCP server using `claude_desktop_config.example.json` or the public Streamable HTTP endpoint.
3. Copy the three `hooks` entries from `settings.hooks.example.json` into the appropriate Claude Code settings file. Replace `ABSOLUTE_PATH` and confirm `KNOWLEDGE_COPILOT_DESKTOP_EXE` matches the installed executable.
4. Restart Claude Code. Enter `@Knowledge Copilot 开启知识沉淀` in a conversation to make that session active. Use `暂停知识沉淀` or `结束知识会话` to stop forwarding.

The hook stores only the latest pending user prompt and an active flag under the OS temporary directory. The state filename is a SHA-256 digest of Claude's session ID, the directory/file permissions are restricted where supported, and `SessionEnd` removes it.

In `server_llm`, the Stop hook forwards the completed text turn. In `host_structured`, the desktop bridge rejects raw capture and the Stop hook tells Claude to call `capture_active_learning_turn` with structured `knowledge_items`; it never silently switches modes.

Claude Desktop and Claude.ai have different lifecycle capabilities. They can use MCP tools, but this Claude Code hook must not be presented as portable continuous capture for those surfaces. MCP Apps UI remains capability-negotiated; the independent desktop window is the consistent UI fallback.
