# Knowledge Copilot 完整线上插件迭代路线

更新日期：2026-08-25

## 1. 目标

把当前本地优先的 Knowledge Copilot 迭代为可公开发布、同时服务 ChatGPT 与 Codex 的完整插件：

```text
Knowledge Copilot Plugin
├── Skill：定义何时沉淀、如何整理和导出知识
├── Remote MCP Server：会话、卡片、修订、状态和导出工具
└── MCP App UI：知识面板
```

最终交付不是“自动读取所有聊天记录”的后台监听器。第一版只处理用户或 Agent 明确授权并提交给插件的内容，不承诺跨宿主自动捕获每一轮，也不声称拥有宿主未提供的历史上下文。

公开发布目标是 OpenAI 的通用 Plugins Directory，而不是仅在本地或 GitHub Marketplace 中分发。官方当前允许 Skills-only、MCP-only 和 Skills + MCP 三种提交形态；本项目选择 Skills + MCP + 可选 UI。

## 2. 当前基线

已经具备：

- v2 知识卡协议、生命周期、真实 cursor 和幂等轮次。
- SQLite 持久化与迁移。
- Mock extractor 和可配置 LLM extractor。
- 10 个知识管理 MCP 工具和 1 个 UI 工具。
- stdio 与 Streamable HTTP MCP transport。
- 单文件 MCP App/独立预览面板。
- Markdown、Mermaid、JSON 导出。
- 类型检查、10 个自动化测试、构建、MCP 冒烟和 HTTP 面板验证。

上线阻塞项：

- HTTP 仅监听 `127.0.0.1`，没有公网 HTTPS 部署形态。
- 无用户认证、租户隔离、授权校验、限流和审计。
- SQLite 未加密，不适合作为多实例、多用户线上主库。
- 工具缺少公开审核要求的风险注解和明确 output schema。
- `.app.json` 尚未绑定 ChatGPT Developer mode 创建的 `plugin_asdk_app...` 连接 ID。
- 缺少正式域名、隐私政策、服务条款、支持页面、品牌素材和提交身份。
- 真实 LLM 的质量、成本、延迟和隐私评测尚未建立。

## 3. 目标架构

```text
ChatGPT / Codex
       │ OAuth / access token
       ▼
Public HTTPS MCP endpoint: /mcp
       │
       ├── Authentication and tenant context
       ├── MCP tools + structured results + UI resource
       ├── Knowledge service
       ├── LLM extraction gateway
       └── audit / metrics / rate limiting
                    │
                    ▼
        Managed relational database
        users / tenants / sessions / turns
        cards / revisions / exports / audit
```

推荐第一版采用单区域、单服务、托管关系型数据库，先保证数据边界和可恢复性，再考虑多区域和异步任务。生产环境不依赖本地磁盘保存用户数据。

## 4. 迭代阶段

### M0：仓库与发布基线

当前状态（2026-08-25）：本地工程门禁已实现，首次本地 commit 随本阶段交付建立。GitHub 远程仓库与默认分支保护尚需 owner/repository 信息和平台权限。当前许可证保守标记为 `UNLICENSED`，待发布主体确认后再改为选定的公开许可证。

工作项：

- 清除历史 v1/v2 目录，只保留 `knowledge-copilot` 主项目。
- 修复 Beta Skill 中断开的 references，并将 Skill 并入最终插件包。
- 建立首次 Git commit、远程仓库和默认分支保护。
- 明确许可证、版本号、CHANGELOG 和 Release 规则。
- 让 CI 在 Node.js 22/24 上执行 `npm ci`、typecheck、test、build、MCP smoke。
- 增加依赖漏洞扫描和禁止提交密钥/SQLite 的检查。

完成标准：

- 全新 clone 后只用文档命令即可构建和测试。
- 主分支没有未提交的源文件，CI 全绿。
- 插件包中的所有相对引用在复制到独立临时目录后仍能解析。

### M1：生产配置与可部署服务

工作项：

- 将监听地址、端口、public base URL、数据库和日志级别全部配置化。
- 生产环境监听 `0.0.0.0`，本地开发默认仍为 `127.0.0.1`。
- 增加容器构建、非 root 用户、健康检查和优雅退出。
- 为 `/mcp`、UI 资源和 health/readiness 分离路由。
- 配置 HTTPS 终止、反向代理、请求体上限、超时和基本限流。
- 增加 `/.well-known/openai-apps-challenge` 域名验证响应能力。

完成标准：

- 容器在空环境中可启动。
- 公网测试环境提供稳定 HTTPS `/mcp`。
- MCP Inspector 能初始化、列工具并调用代表性工具。
- 重启和发布过程中不会留下失效 MCP session 或损坏写入。

### M2：身份认证与多租户数据模型

工作项：

- 选定认证方式并实现用户身份解析。
- 引入 `tenant_id`、`user_id`，为 session/card/export 等实体建立所有权。
- 每一个读写工具都在服务层执行授权校验，不能依赖客户端传入的用户 ID。
- 将生产持久化迁移到托管关系型数据库；保留 SQLite 作为本地开发适配器。
- 增加数据库连接池、迁移锁、唯一约束、备份和恢复演练。
- 增加账户数据导出、会话删除、账户删除与保留期限。

完成标准：

- 用户 A 无法通过猜测 ID 读取或修改用户 B 的任何数据。
- 删除请求能覆盖 turns、cards、revisions、exports 和审计索引中的用户内容。
- 数据库恢复演练达到确定的 RPO/RTO。

### M3：隐私、安全与审计

工作项：

- 在持久化前和 LLM 调用前分别执行敏感信息检测与脱敏。
- API Key、数据库凭据、OAuth secret 只进入托管 Secret。
- 日志不记录原始对话、token、Cookie、Authorization header 或完整工具 payload。
- 增加安全响应头、精确 CORS allowlist 和 MCP App CSP。
- 增加请求 ID、用户可见操作记录和不含敏感正文的审计事件。
- 建立滥用限制、速率限制、成本上限和异常告警。
- 完成威胁模型：越权、提示注入、数据外传、恶意 UI、重放、DoS、ID 枚举。

完成标准：

- 脱敏测试集无已知密钥泄漏。
- 日志抽检不包含用户正文和认证材料。
- 安全测试覆盖跨租户访问、重放、超大输入、注入和异常 LLM 响应。

### M4：MCP 合约与审核元数据

工作项：

- 为每个工具补充准确的 `readOnlyHint`、`openWorldHint`、`destructiveHint`。
- 为结构化结果声明并测试 output schema。
- 收紧工具命名、description 和参数说明，让模型能稳定选对工具。
- 将删除、覆盖或不可逆操作改为显式确认流程；当前非破坏性状态变更也要准确标注。
- 标准化鉴权失败、资源不存在、冲突、限流和内部错误。
- 确保 UI 不可用时，文本和 structured result 仍可完成任务。

完成标准：

- MCP Inspector 对全部工具完成正向、空结果、非法参数和无权限测试。
- 工具选择评测中，正向提示命中预期工具，负向提示不误调用。
- OpenAI Scan Tools 不再报告合约、注解或元数据阻塞问题。

### M5：真实 LLM 提取质量与成本

工作项：

- 选定生产模型供应商、模型 ID、地区和预算。
- 建立脱敏、版本化评测集，覆盖技术排障、操作步骤、产品讨论、纠错、暂停/恢复和无知识噪声。
- 量化漏卡率、错卡率、重复率、纠错成功率、敏感信息泄漏率、延迟和单轮成本。
- 为无效 JSON、schema 失败、超时、限流设置有限重试和安全回滚。
- 对长对话建立窗口、摘要和来源保真策略。
- 把 prompt、schema、模型和评测结果作为可追踪版本发布。

建议首版质量门槛：

- 严重事实错误率为 0。
- 凭据/秘密泄漏率为 0。
- 重复卡片率不高于 5%。
- 被新证据推翻的结论能正确 revise/supersede，不作为并行有效事实保留。
- P95 端到端延迟和单轮成本不超过产品预算。

### M6：MCP App UI 产品化

工作项：

- 验证 ChatGPT 与 Codex 中的面板渲染、主题、尺寸、销毁和恢复。
- 补齐 loading、empty、error、unauthorized、rate limited 状态。
- 保证 session ID 不从不可信 URL 直接获得权限。
- 下载/导出操作使用安全文件名、正确 MIME 和内容清理。
- UI 网络访问严格限制在声明 CSP 的生产域名。
- 进行键盘操作、对比度和基础无障碍测试。

完成标准：

- UI 和无 UI 两条路径都能完成核心工作流。
- 浏览器控制台无错误，认证刷新和断线重连可恢复。
- 不支持 MCP App UI 的宿主仍能正常调用全部非 UI 工具。

### M7：真实宿主 Beta

工作项：

- 在 ChatGPT Developer mode 注册测试 MCP endpoint，获取 `plugin_asdk_app...` ID。
- 用该 ID 生成/修正 `.app.json`，组装 Skills + MCP + UI 插件。
- 在本地 marketplace 安装完整插件，并在全新对话中测试。
- 分别在 ChatGPT 和 Codex 跑完整 E2E：创建会话、提交多轮、暂停/恢复、只看新增、修订、打开面板、导出、重新登录和恢复。
- 每次修改工具或 UI 元数据后刷新 MCP connection，并从新对话重跑回归。
- 邀请少量测试用户，仅使用脱敏或明确授权的数据。

完成标准：

- 至少 5 个正向、3 个负向官方提交用例稳定通过。
- 安装、认证、升级和禁用/卸载路径验证完成。
- 没有 P0/P1 安全、隐私、数据丢失或跨租户问题。

### M8：提交审核与公开发布

工作项：

- 完成 OpenAI Platform 开发者或企业身份验证。
- 确认提交人拥有 `Apps Management: Write`。
- 准备名称、说明、logo、截图、网站、支持、隐私和条款 URL。
- 在 Plugin Submission Portal 创建 `With MCP` 草稿。
- 配置生产 MCP URL、认证、reviewer demo account、CSP 和域名验证。
- Scan Tools，上传最终 Skill bundle，填写 starter prompts、国家/地区、测试案例和 release notes。
- 审核通过后选择发布时间，建立版本升级、回滚和事故响应流程。

完成标准：

- 插件出现在 ChatGPT/Codex 共用的公共 Plugins Directory。
- 线上指标、告警、支持入口、删除请求和回滚流程可用。
- 后续 MCP 元数据或 Skill 变更按“扫描、提交新版本、审核、发布”更新快照。

## 5. 发布门禁

以下任一条件不满足，不进入公开审核：

- 无公网 HTTPS MCP 或域名不可验证。
- 无可靠认证、跨租户隔离或账户删除机制。
- 工具风险注解不完整或与真实副作用不一致。
- 隐私政策没有披露对话存储、LLM 发送范围、保留和删除方式。
- 真实模型评测存在严重事实错误或秘密泄漏。
- 5 个正向、3 个负向用例无法稳定复现。
- ChatGPT 与 Codex 至少各一次真实完整链路未通过。
- 没有监控、备份、回滚或安全联系渠道。

## 6. 需要产品负责人提供的信息

### 立即需要，决定 M0-M2 设计

1. 发布主体：个人还是公司；公开显示的中英文名称。
2. 代码仓库：GitHub owner/repository 名称，公开还是私有，期望许可证。
3. 产品范围：公开插件、仅公司 workspace，还是先封闭 Beta。
4. 目标用户和首要场景：个人学习、研发排障、会议复盘、产品讨论或其他。
5. 数据边界：是否允许保存完整对话；默认保留多久；用户能否关闭原文保存、仅保存卡片。
6. 认证偏好：OpenAI/第三方 OAuth、自有账号体系，或尚未决定。
7. 基础设施偏好：云厂商/部署平台、数据库、域名和目标地区；没有偏好时可由实现方案推荐。
8. LLM 选择：OpenAI 或兼容供应商、目标模型、API 归谁付费、月度预算和允许的数据处理地区。

### 测试环境上线前需要

9. 测试域名或可配置 DNS 的域名。
10. 云账号/项目和最小权限部署方式；不要在文档或聊天中直接发送长期密钥。
11. 测试用户名单和可公开/可脱敏的真实场景样本。
12. 延迟、可用性、单用户配额和成本上限。
13. 数据删除、导出、备份的期望时限，以及可接受的 RPO/RTO。

### 提交审核前需要

14. 已验证的 OpenAI Platform 组织和拥有 `Apps Management: Write` 的提交人。
15. 官网、支持邮箱/支持页、隐私政策、服务条款的最终 URL。
16. 产品 logo、图标、品牌色、截图和公开文案。
17. 发布国家/地区、年龄/行业限制及不支持的使用场景。
18. Reviewer demo account 或无需私人数据即可复现的审核 fixture。
19. 安全漏洞接收渠道、值班/事故联系人和用户删除请求渠道。

## 7. 默认决策（在负责人未指定时）

- 首版面向少量封闭 Beta 用户，再提交公开目录。
- 单区域部署；关系型托管数据库；SQLite 仅用于本地开发。
- 保存卡片和修订；完整对话默认短期保留且允许用户关闭/删除。
- 所有写操作在已认证用户自己的私有空间内完成，`openWorldHint=false`。
- 不提供被动全量聊天监听，不把“Agent 主动调用工具”宣传成强保证的逐轮自动捕获。
- 先优化安全、隔离和质量，再做计费、分享、协作和多区域。

## 8. 参考规范

- OpenAI 插件架构：https://developers.openai.com/plugins/concepts/plugins
- 插件打包：https://developers.openai.com/plugins/build/plugins
- MCP 连接与测试：https://developers.openai.com/plugins/deploy/connect-chatgpt
- 插件认证：https://developers.openai.com/plugins/build/auth
- 提交与发布：https://developers.openai.com/plugins/deploy/submission
- 安全与隐私：https://developers.openai.com/plugins/guides/security-privacy
