# Host capability matrix

Checked against official documentation on 2026-08-28. “待验证” means no sufficient official evidence or no live product test in this environment.

| Host/surface | Capture connection | In-host UI | Continuous capture boundary | External desktop companion |
|---|---|---|---|---|
| ChatGPT app | Public Streamable HTTP MCP | Interactive app UI supported | App selection applies to the current message; later messages cannot be passively read | Yes; persistent display only |
| Codex local/plugin | MCP/plugin configuration + packaged skill | Product/version-dependent | Agent-driven MCP capture; no separate post-turn hook claimed | Yes; deep-link/tool wake |
| Claude Code | Local or remote MCP + official command hooks | MCP Apps support must be negotiated | `UserPromptSubmit` + `Stop` + `SessionEnd` adapter implemented | Yes; hook/tool wake |
| Claude Desktop / Claude.ai | MCP capability depends on surface | MCP Apps support must be negotiated | No Claude Code hook portability assumed | Yes; tool wake |
| Claude.ai / Messages API connector | Public HTTP tool connector | Surface-dependent | Calling application controls tool timing | Yes; persistent display only |
| Tencent WorkBuddy | MCP connector/config | **待验证** | **待验证**: no authoritative post-turn hook contract found | Yes; persistent display only |

Official sources:

- MCP specification and SDK: https://modelcontextprotocol.io/
- MCP Apps overview, progressive enhancement, supported clients and testing: https://apps.extensions.modelcontextprotocol.io/
- OpenAI developer/plugin documentation: https://developers.openai.com/
- OpenAI Apps SDK ChatGPT UI and app-selection behavior: https://developers.openai.com/apps-sdk/build/chatgpt-ui
- Anthropic MCP product documentation: https://docs.anthropic.com/en/docs/mcp
- Claude Code hooks: https://docs.anthropic.com/en/docs/claude-code/hooks
- Anthropic Messages API connector limitations: https://docs.anthropic.com/en/docs/agents-and-tools/mcp-connector
- Tencent Cloud WorkBuddy MCP connector article: https://cloud.tencent.cn/developer/article/2698011

The same MCP App UI is not claimed to run on every host. UI registration is a progressive enhancement; tool-only operation is the compatibility floor. The desktop companion gives every host the same movable display. ChatGPT uses a narrowly scoped, explicitly confirmed DOM adapter; Claude Code uses official command hooks; Codex uses an agent/tool contract; WorkBuddy remains tool-driven until an official lifecycle API is verified. No adapter reads arbitrary windows, screenshots, keystrokes, clipboard data, or unrelated tabs.
