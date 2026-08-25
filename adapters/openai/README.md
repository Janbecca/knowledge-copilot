# OpenAI adapter

This is a thin configuration adapter; shared code does not import it.

- Codex plugin discovery can use the repository `.codex-plugin/plugin.json` and `.mcp.json` after installation/reload.
- The MCP server is verified independently over stdio/Streamable HTTP. A live Codex plugin reload was not performed in this development session.
- ChatGPT app distribution normally requires a reachable remote MCP server and current Apps SDK configuration. Local-only SQLite and localhost are not presented as a deployed ChatGPT app.
- Do not assume the host calls `capture_conversation_turn` automatically. The user/agent must call it after a completed turn unless a separately authorized lifecycle integration exists.
