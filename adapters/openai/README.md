# OpenAI adapter

This repository exposes one MCP contract to ChatGPT and Codex; host-specific adapters only decide how a completed turn reaches it.

- ChatGPT uses the public Streamable HTTP MCP endpoint. The optional narrow browser extension supplies per-conversation lifecycle detection after explicit confirmation; it never holds cloud credentials.
- Codex plugin discovery can use `.codex-plugin/plugin.json`, `.mcp.json`, and the packaged capture skill after installation/reload. The skill asks the current Codex agent to invoke MCP tools after substantive replies.
- Codex does not have a portable browser-extension-style post-turn hook in this implementation. Continuous saving therefore depends on the installed skill/tool contract, not screen scraping.
- In `host_structured`, the current OpenAI host must submit `knowledge_items`. In `server_llm`, an authorized adapter may submit the completed raw turn to the configured server extractor.

The desktop companion is the shared movable window and wake target. An inline MCP App view is only a progressive enhancement and is not described as a browser sidebar.
