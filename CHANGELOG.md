# Changelog

遵循 [Semantic Versioning](https://semver.org/)。

## Unreleased

- 增加生产/本地监听策略、统一运行配置、健康/就绪路由、请求上限、超时、CORS、基础限流和域名 challenge。
- 增加非 root 多阶段容器、Caddy HTTPS 终止示例和 MCP transport 优雅停机。
- 补齐最终插件包与 Beta Skill 的内置 references，并增加独立复制校验。
- 增加密钥/SQLite 提交检查、Node.js 22/24 CI 和高危依赖漏洞门禁。
- 明确 Beta 版本号和发布规则。

## 0.1.0-beta.1 - 2026-08-17

- 建立 GitHub Marketplace Beta 插件骨架和迭代路线。
- 已验证本地 TypeScript、自动测试、MCP 冒烟测试与面板构建。
- Beta 插件当前提供对话知识沉淀技能；持久化 MCP 服务仍为可选本地伴随服务。
