# ChatGPT 网页版优先技术方案与开发计划

更新日期：2026-09-01

## 1. 目标

第一阶段只打通 Windows 桌面端、Chrome 扩展与 `chatgpt.com`。用户完成一次登录和扩展连接后，可在每个 ChatGPT 对话中通过悬浮入口单独开启、暂停或结束知识沉淀；桌面驾驶舱根据当前对话自动展开、切换或收起，并能恢复历史知识总结。

本阶段不承诺 GPT 桌面端、Claude Code 或 WorkBuddy 的连续捕获，也不承诺导入 ChatGPT 未加载到页面中的全部历史消息。

## 2. 已落地的前端垂直切片

- 桌面端四步首次使用引导：登录账号、选择 AI 工具、安装扩展、完成。
- ChatGPT 网页版作为唯一可用首选工具；其他宿主后置。
- Chrome 扩展安装说明、隐私边界、检测中、未连接和已连接状态。
- 扩展启动后通过 Native Messaging 发送 `extension_hello`；桌面端把真实握手标记保存在 Windows 凭据管理器。
- 桌面端只在收到真实握手后显示“Chrome 扩展已连接”。
- 完成页引导用户打开 ChatGPT，并通过悬浮“知”入口开启第一次知识沉淀。

当前登录仍打开现有 Web 面板并由用户手工返回确认；Chrome 商店链接仍需替换为正式扩展详情页。这两项属于后续 P0，而不是已完成能力。

## 3. 目标架构

```text
ChatGPT 页面
  -> Chrome 内容脚本：显示入口、识别 conversation_ref、读取已授权轮次
  -> Chrome Service Worker：状态管理、幂等、Native Messaging
  -> 桌面 Native Host：账号设备身份、会话路由、重试队列
  -> Knowledge Copilot API：授权验证、脱敏、提取、持久化
  -> DeepSeek：server_llm 知识提取
  -> 桌面驾驶舱：按 conversation_ref 展示对应 session
```

Chrome 扩展不保存长期设备密钥；桌面端不读取屏幕、键盘或剪贴板。ChatGPT 网页版第一阶段固定使用 `server_llm`，不向普通用户展示 `host_structured` 选择。

## 4. 必须新增的数据模型

新增 `conversation_bindings`：

```text
binding_id
owner_user_id
source_host
conversation_ref
session_id
capture_status       off | active | paused | ended
created_at
updated_at
last_seen_at
```

唯一约束：`(owner_user_id, source_host, conversation_ref)`。

当前 Windows 凭据管理器中的全局 `active-capture-route` 必须废弃，改为由服务器绑定关系决定路由，避免新对话写入旧会话。

## 5. API 设计

建议新增：

- `POST /api/conversation-bindings/resolve`：根据 `source_host + conversation_ref` 查询或创建绑定。
- `GET /api/conversation-bindings/:source/:conversationRef`：恢复历史会话和捕获状态。
- `POST /api/conversation-bindings/:id/status`：开启、暂停、恢复或结束。
- `POST /api/conversation-bindings/:id/presence`：报告前台、后台、关闭，用于桌面展示状态；不改变捕获授权。
- `POST /api/conversation-bindings/:id/capture`：提交完成轮次，由绑定关系解析 `session_id`。

设备身份、用户归属和逐对话授权仍在服务器二次校验。所有写接口继续要求幂等键。

## 6. 状态拆分

不要继续把所有状态压进一个“采集开关”：

- 捕获状态：`off / active / paused / ended`。
- 页面存在状态：`foreground / background / closed`。
- 桌面显示状态：`expanded / orb / minimized`。
- 扩展连接状态：`missing / checking / connected / incompatible / error`。

推荐窗口规则：

- 切到已开启对话：桌面切换并展开对应知识会话。
- 切到未开启对话：桌面延迟收起为悬浮球。
- 离开 ChatGPT：桌面延迟收起；用户置顶时保持展开。
- 回到历史对话：恢复原 session、知识卡片和捕获状态。
- 页面切换时仍在生成的回答：完成当前轮提交后再进入后台。

## 7. 登录与安装

桌面端登录必须从 iframe 改为系统浏览器 OAuth 2.0 Authorization Code + PKCE：

1. 桌面端生成 state、nonce 和 PKCE verifier。
2. 系统浏览器打开 Auth0 授权页。
3. Auth0 回调 `knowledge-copilot://auth/callback?...`。
4. 桌面端校验 state 并交换短期令牌。
5. Refresh Token 或设备凭证进入 Windows 凭据管理器。

Chrome 扩展必须发布到 Chrome Web Store 以获得固定 ID。桌面安装器用固定 ID 注册 Native Messaging Manifest；用户仍需在 Chrome 中亲自确认安装和权限。

## 8. 分阶段开发计划

### P0.1：首次使用闭环

- [x] 桌面端完成 OAuth Authorization Code + PKCE 代码闭环，删除“我已完成登录”的手工确认；回调成功后自动创建设备凭证并保存到 Windows 凭据管理器。
- [x] API 支持独立桌面 Native Application client ID，避免桌面端复用 SPA client。
- 发布私有/测试版 Chrome Web Store 扩展并固化 ID。
- [x] 桌面程序首次启动自动注册 Native Messaging Host；发布构建通过 `KNOWLEDGE_COPILOT_EXTENSION_ID` 注入商店固定 ID，无需用户执行脚本。
- [x] 扩展握手增加版本、浏览器和两分钟心跳；桌面端超过五分钟未收到心跳即显示连接失效。
- 完成标准：新电脑从安装桌面端到看到“ChatGPT 网页版已连接”无需命令行。

上线前仍需完成两项外部配置：在 Auth0 创建 Native Application，将 `knowledge-copilot://auth/callback` 加入 Allowed Callback URLs，并设置 `KNOWLEDGE_COPILOT_OIDC_DESKTOP_CLIENT_ID`；Chrome Web Store 首次发布后，将获得的 32 位 ID 作为 `KNOWLEDGE_COPILOT_EXTENSION_ID` 注入桌面发布构建。

### P0.2：逐对话绑定与悬浮入口

- [x] 新增 `conversation_bindings` 迁移、所有权服务和设备 API。
- [x] 扩展在 `/c/<id>` 注入可键盘操作的悬浮“知”入口。
- [x] 首次点击默认“从现在开始”，授权后先标记当前已完成轮次，避免把授权前历史误当成新轮次提交。
- [x] 绑定会话固定为 `server_llm`，捕获按绑定解析 session，不再读取全局最近会话路由。
- [x] 暂停、恢复、结束、历史恢复和页面 presence 均同步到服务器；已开启会话进入前台时唤醒对应驾驶舱，离开时请求收起。
- 完成标准：两个 ChatGPT 对话不会串写，刷新或重新打开后可恢复。

### P0.3：连续捕获与桌面联动

- [x] 仅在助手流式输出结束后组合用户/助手轮次，并用稳定幂等键提交。
- [x] 扩展提供最多 100 条的本地持久待发送队列、指数退避、定时重试和队列满错误。
- [x] 扩展上报 foreground/background；桌面按绑定切换、展开或收起。
- [x] 桌面驾驶舱改为本地渲染：原生层使用 Windows 凭据管理器中的设备凭证读取当前绑定会话，前端不接触凭证；CSP 禁止 iframe。完整 Web 面板仅由用户主动在系统浏览器打开。
- [ ] 在真实 ChatGPT 网页完成连续十轮、三个会话切换和断网恢复的人工验收。
- 完成标准：连续十轮、切换三个会话、断网恢复均不漏写、不串写、不重复。

### P1：历史、删除与发布质量

- 可选“整理当前可见历史”，默认仍从现在开始。
- 会话结束、知识保留、删除原文和删除全部数据的明确入口。
- 多窗口、多 Chrome Profile、扩展升级和桌面自动更新。
- 代码签名、崩溃遥测、监控、备份与回滚。

### P2：其他宿主

- Claude Code 官方 Hooks。
- GPT 桌面端独立适配器。
- WorkBuddy 在官方生命周期接口明确后再开发。

## 9. 验收场景

1. 未安装扩展时桌面端不能显示假成功。
2. 扩展安装后桌面端自动检测并进入完成页。
3. 未开启的对话不读取消息正文。
4. A、B 两个对话分别开启后，卡片严格进入各自 session。
5. A 切到未开启的 B 时桌面收起；切到已开启的 B 时桌面切换。
6. 重新打开 A 时恢复历史知识总结。
7. 暂停只停止新增捕获，不删除历史。
8. 撤销授权后设备提交返回 403。
9. 断网期间内容保留，恢复后幂等补交。
10. Auth0 登录全过程不在 iframe 中发生。
