# Knowledge Copilot Desktop Companion

Windows-first 的轻量 Tauri 2 桌面外壳。它把线上知识面板放进独立、可拖动、可缩放、始终置顶的窗口，并支持收起为悬浮球。

## 边界

- 复用 `https://knowledge-copilot.xyz` 的 API、数据和域名。
- 只允许加载该 HTTPS 来源；远程面板运行在受限 iframe 中。
- 桌面外壳只拥有拖动、置顶、调整尺寸、最小化和关闭窗口权限。
- 不读取其他应用的窗口、屏幕、剪贴板或键盘，也没有 shell、文件系统或任意网络访问权限。
- 它解决“笔记持续可见”，不解决“宿主每轮自动提交”。捕获仍由 MCP 工具调用或宿主专用 Hook 完成。

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

启动后默认显示面板最近一次会话。点击“会话”可粘贴 `session_id`，点击图钉切换始终置顶，圆点按钮收起为 86×86 悬浮球。会话 ID 只保存在当前 Windows 用户的 WebView 本地存储中。

当前个人 Beta 尚未加入账号登录、设备同步密钥、代码签名、自动更新和崩溃遥测。公开分发前必须补齐服务端鉴权和签名；未签名安装包可能触发 Windows SmartScreen 提示。
