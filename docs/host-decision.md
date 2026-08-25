# First host decision

## Decision

Use the standard MCP/MCP Apps architecture plus local standalone preview as the first end-to-end validation target. Package a Codex plugin adapter as the first product-specific adapter, but label live Codex installation/reload as unverified in this turn.

## Rationale

1. The current environment is Codex and `plugin-creator` provides an officially validated local plugin/MCP/App manifest path.
2. MCP Apps official documentation defines `ui://` resources, sandboxed Views, bidirectional tool calls, capability negotiation, and a basic-host reference implementation.
3. This lets the shared server and UI follow a standard without claiming a fixed sidebar.
4. WorkBuddy officially supports MCP connectors, but the searched official material did not establish compatible MCP Apps rendering or a stable post-turn Hook contract. Selecting it as “validated automatic capture” would overstate evidence.
5. Installing/restarting external desktop hosts would be a separate user-authorized environment change. Therefore the local MCP endpoint and preview are actually exercised; product host configs remain thin adapters.

## Missing validation

- Install/reload this plugin in a fresh Codex session and call tools from that host.
- Exercise `open_knowledge_panel` in an MCP Apps-capable host and verify theme, resource teardown, and download behavior.
- Confirm WorkBuddy UI extension and lifecycle APIs from authoritative product docs or a live supported build.
