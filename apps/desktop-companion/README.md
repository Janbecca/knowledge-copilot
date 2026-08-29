# Knowledge Copilot Desktop Companion

Windows-first 的轻量 Tauri 2 桌面外壳。它把线上知识面板放进独立、可拖动、可缩放、始终置顶的窗口，并支持收起为悬浮球。

## 已实现能力

- 注册 `knowledge-copilot://wake?token=...`，已安装时自动启动或唤醒唯一桌面实例并置前。
- 只接受格式正确的短时一次性唤醒令牌；深链不携带对话正文、OAuth 令牌或设备密钥。
- 在原生层通过 HTTPS 消费唤醒令牌，前端 JavaScript 不接触设备密钥。
- 设备密钥保存在 Windows 凭据管理器，不写入 WebView `localStorage`、日志或 URL。
- 浮窗明确显示“采集关闭 / 正在验证 / 等待授权 / 错误”，唤醒不等于自动授权采集。
- 第二次启动由单实例插件转交给现有窗口，并恢复、显示和聚焦该窗口。
- 同一可执行文件提供 Chrome Native Messaging 帧协议和 Claude Code 单次 JSON Hook 桥接；两者只允许唤醒、授权/撤销和完整轮次提交。

## 边界

- 复用 `https://knowledge-copilot.xyz` 的 API、数据和域名。
- 只允许加载该 HTTPS 来源；远程面板运行在受限 iframe 中。
- 桌面外壳拥有窗口控制、固定域名 HTTPS 唤醒交换和 Windows 凭据管理能力。
- 不读取其他应用的窗口、屏幕、剪贴板或键盘，也没有 shell、文件系统或任意网络访问权限。
- 它解决“笔记持续可见”和“可信唤醒”；宿主每轮提交仍由 MCP 生命周期事件或单独授权的宿主适配器完成。

## 本地预览

只验证界面，不启动原生窗口：

```powershell
npm.cmd install
npm.cmd run preview:desktop
```

打开 `http://localhost:5174`。浏览器预览中的置顶、最小化和关闭按钮会安全地不执行原生操作。

## Windows 原生开发与打包

先安装：

1. Microsoft C++ Build Tools（Desktop development with C++）。
2. Microsoft Edge WebView2 Runtime。
3. Rust stable MSVC toolchain。

然后运行：

```powershell
npm.cmd run desktop:dev
npm.cmd run desktop:build
```

NSIS 安装包位于 `apps/desktop-companion/src-tauri/target/release/bundle/nsis/`。

## 使用

启动后默认显示面板最近一次会话。点击“会话”可粘贴 `session_id` 或保存一次性显示的 `kc_device_...` 配对令牌，点击图钉切换始终置顶，圆点按钮收起为 86×86 悬浮球。会话 ID 只保存在当前 Windows 用户的 WebView 本地存储中；设备令牌只保存在 Windows 凭据管理器。

当前个人 Beta 尚未完成浏览器账号登录、代码签名、自动更新和崩溃遥测。服务端 OIDC、账号归属、设备撤销和授权记录已经实现，但在配置正式身份提供商前不会开启公网多用户采集。未签名安装包可能触发 Windows SmartScreen 提示。
