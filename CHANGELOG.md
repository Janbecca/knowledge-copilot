# Changelog

遵循 [Semantic Versioning](https://semver.org/)。

## Unreleased

- 增加按会话持久化并可在前端切换的双提取模式：当前 AI 直接提交结构化知识，或服务器调用自配 OpenAI 兼容 LLM。
- 默认使用当前 AI 整理模式，避免意外的模型费用和第三方数据传输；服务器密钥不会进入前端或数据库。
- 增加 `change_extraction_mode` MCP/HTTP 能力，以及提取失败不消耗轮次游标的事务保证。
- 增加 Windows-first Tauri 桌面伴侣：无边框、可拖动缩放、始终置顶、悬浮球收起、会话切换，并以最小权限加载固定 HTTPS 知识面板。
- 增加桌面端权限与来源约束测试，并将桌面 UI 纳入默认构建。
- 明确 ChatGPT 应用选择只作用于当前消息；桌面常驻显示不等于跨消息被动捕获。
- 增加 ChatGPT 匿名对话绑定与 `capture_active_learning_turn`，首次启动后可在后续实质轮次继续写入同一学习会话。
- 增加由宿主模型提交结构化知识点的采集路径，避免线上 mock 提取器只能识别演示关键词。
- 知识面板支持请求 PiP 悬浮、切换全屏、打开独立窗口，并在可见时自动刷新。
- 为全部 MCP 工具增加准确的风险注解、封闭世界声明和结构化输出 Schema。
- 统一工具领域错误为稳定的 `not_found`、`conflict`、`internal_error` 结果，并避免泄漏未知内部异常。
- 增加覆盖全部 15 个工具、空结果、幂等重放和非法参数的 MCP 合约测试。
- 增加生产/本地监听策略、统一运行配置、健康/就绪路由、请求上限、超时、CORS、基础限流和域名 challenge。
- 增加非 root 多阶段容器、Caddy HTTPS 终止示例和 MCP transport 优雅停机。
- 移除 Windows-only Rollup 直接依赖，修复 Linux `npm ci`。
- 补齐最终插件包与 Beta Skill 的内置 references，并增加独立复制校验。
- 增加密钥/SQLite 提交检查、Node.js 22/24 CI 和高危依赖漏洞门禁。
- 明确 Beta 版本号和发布规则。

## 0.1.0-beta.1 - 2026-08-17

- 建立 GitHub Marketplace Beta 插件骨架和迭代路线。
- 已验证本地 TypeScript、自动测试、MCP 冒烟测试与面板构建。
- Beta 插件当前提供对话知识沉淀技能；持久化 MCP 服务仍为可选本地伴随服务。
