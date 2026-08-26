# Changelog

遵循 [Semantic Versioning](https://semver.org/)。

## Unreleased

- 为全部 MCP 工具增加准确的风险注解、封闭世界声明和结构化输出 Schema。
- 统一工具领域错误为稳定的 `not_found`、`conflict`、`internal_error` 结果，并避免泄漏未知内部异常。
- 增加覆盖全部 11 个工具、空结果、幂等重放和非法参数的 MCP 合约测试。
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
