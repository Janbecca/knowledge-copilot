# Knowledge Copilot / 对话知识副驾驶

平台中立、本地优先的情境化学习旁路。宿主或适配器在一轮对话结束后显式调用捕获工具；SQLite 保存真实会话、轮次、卡片、修订和 cursor；MCP Apps-capable 宿主可显示知识面板，其他宿主仍可使用标准工具和独立预览页。

本项目不会在没有宿主 Hook、工具调用或用户授权时监听对话。

> 发布状态：本项目正准备发布为 GitHub Marketplace Beta。版本节奏、升级方式、已知边界和公开目录门槛见 [发布与迭代路线](docs/release-roadmap.md)。

第一次了解项目，建议先阅读：[功能使用与逻辑原理（2026-08-10）](docs/功能使用与逻辑原理-2026-08-10.md)。

## 当前实现状态

- **已实现并可本地验证**：v2 卡片协议、六种生命周期事件、真实 cursor、幂等轮次、SQLite迁移、mock extractor、可配置 LLM extractor、14 个 MCP 工具、ChatGPT 会话绑定、PiP/全屏/独立窗口面板、Streamable HTTP/stdio、Markdown/Mermaid/JSON导出、自动测试。
- **已实现但待真实产品验证**：Codex/Claude/WorkBuddy 的薄配置样例；MCP App在具体商业宿主中的渲染。
- **已实际验证的标准环境**：本地 HTTP/stdio MCP Server、独立 UI 预览；MCP Apps官方协议形态。详见 `docs/testing.md`。
- **受宿主限制**：逐轮自动调用依赖宿主 lifecycle hook 或 agent行为；固定侧栏不是 MCP Apps 的通用保证。

## GitHub Marketplace Beta

仓库级 Marketplace 已提供可安装的 `knowledge-copilot-beta` 技能包。它用于在当前 Codex 对话中进行诚实的知识沉淀；不承诺被动读取全部聊天，也不替代下方的本地 MCP 服务。根目录已有完整 MCP 插件配置，待免配置打包完成后将以正式名称发布。

公开仓库发布后，安装者可运行：

```powershell
codex plugin marketplace add OWNER/knowledge-copilot --ref main
```

然后在 Codex 插件目录安装 `knowledge-copilot-beta`。更新使用 `codex plugin marketplace upgrade`，并在新任务中验证。完整版本策略见 [发布与迭代路线](docs/release-roadmap.md)。

## 快速开始（Windows PowerShell）

```powershell
cd E:\Coding小项目\capture-conversation-knowledge\knowledge-copilot
npm.cmd ci
npm.cmd run db:init
npm.cmd run build
$env:KNOWLEDGE_COPILOT_EXTRACTOR='mock'
npm.cmd start
```

打开 `http://127.0.0.1:3210/app/`。面板中可创建会话，并在“开发调试：提交一轮”中输入：

- 用户消息：`运行 esptool read-flash 保存 backup.bin`
- 助手消息：`读取完成；设备 Flash 未被改写，请验证文件大小和哈希。`

提交后可看到操作卡片、真实 cursor、来源和导出结果。也可运行完整 CLI demo：

```powershell
npm.cmd run demo
```

## MCP Server

stdio：

```powershell
$env:KNOWLEDGE_COPILOT_EXTRACTOR='mock'
node dist/mcp-server/index.js --stdio
```

Streamable HTTP：

```powershell
npm.cmd start
# MCP endpoint: http://127.0.0.1:3210/mcp
# Health:       http://127.0.0.1:3210/health
# Readiness:    http://127.0.0.1:3210/ready
# Panel:        http://127.0.0.1:3210/app/
```

## 容器部署

服务镜像使用 Node.js 24、非 root 用户、`/ready` 健康检查和 SIGTERM 优雅退出。本地验证镜像：

```powershell
docker build -t knowledge-copilot:local .
docker run --rm -p 3210:3210 -e KNOWLEDGE_COPILOT_EXTRACTOR=mock knowledge-copilot:local
```

公网测试环境使用 `compose.yaml` 与 Caddy 自动终止 HTTPS。域名、DNS 和部署步骤见 [部署指南](docs/deployment.md)。SQLite 卷仅适合单实例 Beta；进入 M2 后生产主库将迁移到托管关系型数据库。

工具：`start_learning_session`、`rename_learning_session`、`capture_conversation_turn`、`capture_active_learning_turn`、`get_learning_session`、`list_knowledge_cards`、`get_knowledge_card`、`revise_knowledge_card`、`change_capture_status`、`change_card_learning_status`、`list_learning_debts`、`export_learning_package`，以及 UI 工具 `launch_knowledge_copilot`、`open_knowledge_panel`。

在 ChatGPT 中，首次调用 `launch_knowledge_copilot` 会将学习会话绑定到当前匿名对话标识，并请求以 PiP 悬浮方式展示。之后模型应在每个有实质内容的回答后调用 `capture_active_learning_turn`，无需用户再次 `@` 或传递 `session_id`。这是一套工具调用约定，并非能够被 MCP 应用绕过宿主权限实现的被动消息监听。

## 真实模型配置

复制 `.env.example` 的值到当前进程环境，至少设置：

```text
KNOWLEDGE_COPILOT_EXTRACTOR=llm
KNOWLEDGE_COPILOT_BASE_URL=https://your-openai-compatible-endpoint/v1
KNOWLEDGE_COPILOT_API_KEY=...
KNOWLEDGE_COPILOT_MODEL=your-model-id
```

模型名、Key和Base URL均不写死。结构化输出先经 v2 schema 验证，有限修复后仍失败则整轮卡片更新回滚。日志不打印 Key。

## 数据与隐私

对话默认保存在本地 `data/knowledge-copilot.sqlite`。API Key不会写入数据库；常见 Key/token/password 形式会在轮次落库前脱敏。生产使用仍需加密、访问控制、删除流程和更完整的敏感信息识别，详见 `docs/privacy-and-data.md`。

## 开发验证

```powershell
npm.cmd run typecheck
npm.cmd run test:unit
npm.cmd run test:integration
npm.cmd test
npm.cmd run build
npm.cmd run verify:plugin
npm.cmd run test:mcp
```

`npm.cmd run verify` 会执行仓库敏感文件检查、类型检查、全部测试、构建、插件包独立复制校验和 MCP 冒烟。依赖漏洞门禁在 CI 中通过 `npm audit --audit-level=high` 执行。

架构、宿主能力和测试证据分别见 `docs/architecture.md`、`docs/host-capability-matrix.md`、`docs/testing.md`。
