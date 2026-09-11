# WorkBuddy adapter

Official Tencent material confirms WorkBuddy connectors use MCP. The project therefore supplies a standard local stdio example below.

No sufficiently specific official documentation was found during this iteration to confirm that WorkBuddy renders the MCP Apps UI extension or exposes a post-turn hook with the semantics required here. Those capabilities remain **待验证**. Until verified, use the MCP tools agent-driven and let `launch_knowledge_copilot` wake the independent desktop window.

Do not enable window scraping as a substitute. A WorkBuddy-specific continuous adapter will be added only after its official lifecycle/extension API and consent surface can be verified in the installed product. The standard MCP configuration still supports session management, mode switching, explicit structured capture, and knowledge review.
