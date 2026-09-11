# ChatGPT capture extension

Manifest V3 的最小权限适配器。它只注入 `https://chatgpt.com/*`，不申请 tabs、history、clipboard、downloads、scripting 或全站 host 权限。

## 当前行为

- 在 `/c/<conversation-id>` 对话中检测 Knowledge Copilot 调用词。
- 首次检测只显示授权提示，不读取、不提交，也不会自动打开桌面应用或安装页。
- 用户必须在页面上的固定状态条确认“授权当前对话”。授权按 ChatGPT conversation ID 分开保存。
- 授权后只读取带 `data-message-author-role=user|assistant` 的文字节点；不读取输入框、密码字段、其他标签页、截图、剪贴板或键盘。
- 助手文本稳定后提交最后一个完整轮次，使用内容哈希幂等去重；失败不会标记为已发送。
- 每个 `/c/<conversation-id>` 页面显示可键盘操作的悬浮“知”入口；展开后可从现在开始、打开驾驶舱、暂停、恢复或结束。
- 逐对话绑定、捕获状态和页面 presence 以服务器为准，Chrome 本地存储只作为离线展示缓存；刷新或再次打开历史对话会恢复原知识会话。
- 所有网络与设备操作通过受限 Native Messaging host `xyz.knowledge_copilot.desktop`；扩展自身不持有云端 OAuth 或设备令牌。
- 扩展启动及每两分钟向桌面端发送版本化心跳；桌面端五分钟收不到心跳即把连接标记为失效。

## 两种提取模式的连续性

- `server_llm`：扩展在逐会话授权后可持续提交完整文字轮次，由服务器配置的模型提取。
- `host_structured`：知识点必须由正在回答的 ChatGPT 通过 MCP 工具提交。扩展只能负责唤醒、授权状态和兜底检测，不能假冒当前 AI 生成结构化知识点，也不会擅自切换到服务器 LLM。插件提示词仍要求 ChatGPT 在后续实质回答后调用 `capture_active_learning_turn`。

## 开发加载

1. 在 Chrome 打开 `chrome://extensions`，开启开发者模式。
2. 选择“加载已解压的扩展程序”，目录指向 `apps/chatgpt-extension`。
3. 记录 Chrome 生成的扩展 ID。
4. 以当前用户运行：

```powershell
.\scripts\install-chrome-native-host.ps1 -AppPath "<Knowledge Copilot.exe 的绝对路径>" -ExtensionId "<32 位扩展 ID>"
```

正式桌面安装器必须用商店固定 ID 自动完成同一注册。Native host 指向同一个桌面 EXE；Chrome 以 Native Messaging 参数启动时，程序进入无窗口 stdio 桥接模式。

发布构建设置 `KNOWLEDGE_COPILOT_EXTENSION_ID=<Chrome Web Store 的 32 位扩展 ID>`。该 ID 会编译进桌面程序；程序首次启动时自动为当前 Windows 用户写入受限 manifest 和 Chrome 注册表项，不需要用户执行 PowerShell。

Host 未安装或暂时不可用时，扩展只在状态条显示错误和安装地址，不会未经用户操作自动打开新标签页；捕获会保持未发送状态。原生桥只支持 `wake`、`grant_consent`、`revoke_consent` 和 `capture_turn` 四种有限消息，单条消息上限 1 MB；云端再次校验设备、会话归属和逐会话授权。
