# Host capability matrix

Checked against official documentation on 2026-08-09. “待验证” means no sufficient official evidence or no live product test in this environment.

| Host/surface | Local stdio MCP | Remote HTTP MCP | MCP Apps interactive UI | Hooks/lifecycle for post-turn capture | This iteration |
|---|---:|---:|---:|---:|---|
| MCP Apps basic-host/reference approach | Yes via its MCP client setup | Yes | Yes; reference implementation | Host integration responsibility | Protocol target; local server/UI tested, upstream basic-host not bundled |
| Codex local/plugin | Official OpenAI plugin surface supports MCP configuration | Product-dependent | Optional plugin UI exists; exact MCP Apps rendering in this local build not live-tested | No automatic post-turn guarantee assumed | Plugin scaffold + config;待真实宿主验证 |
| ChatGPT app | Localhost not treated as deployable app | Official Apps SDK uses a remote MCP server | Interactive app UI supported through current OpenAI app tooling | No general passive transcript hook assumed | Remote deployment/auth not implemented |
| Claude Desktop / Claude Code | Official Anthropic docs support local MCP servers | Supported depending on surface/config | MCP Apps docs list compatible Claude surfaces, but capability must be negotiated | No portable post-turn hook assumed | Config skeleton only |
| Claude.ai / Messages API connector | No direct local stdio in API connector | Messages API connector requires public HTTP and currently focuses on tool calls | Surface-dependent; not inferred from API connector | API integration controls call timing | Not deployed/tested |
| Tencent WorkBuddy | Official Tencent material confirms MCP connector/config | Connector-dependent | **待验证**: no sufficient official MCP Apps UI statement found | **待验证**: no authoritative post-turn hook contract found | stdio config skeleton only |

Official sources:

- MCP specification and SDK: https://modelcontextprotocol.io/
- MCP Apps overview, progressive enhancement, supported clients and testing: https://apps.extensions.modelcontextprotocol.io/
- OpenAI developer/plugin documentation: https://developers.openai.com/
- Anthropic MCP product documentation: https://docs.anthropic.com/en/docs/mcp
- Anthropic Messages API connector limitations: https://docs.anthropic.com/en/docs/agents-and-tools/mcp-connector
- Tencent Cloud WorkBuddy MCP connector article: https://cloud.tencent.cn/developer/article/2698011

The same MCP App UI is not claimed to run on every host. UI registration is a progressive enhancement; tool-only operation is the compatibility floor.
