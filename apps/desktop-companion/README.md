# Knowledge Copilot Desktop Companion

Windows-first 的轻量 Tauri 2 桌面驾驶舱。它在本地渲染当前 ChatGPT 绑定会话的知识卡片，可拖动、缩放、置顶，并支持收起为悬浮球。

## 已实现能力

- 注册 `knowledge-copilot://wake?token=...`，已安装时自动启动或唤醒唯一桌面实例并置前。
- 只接受格式正确的短时一次性唤醒令牌；深链不携带对话正文、OAuth 令牌或设备密钥。
- 在原生层通过 HTTPS 消费唤醒令牌，前端 JavaScript 不接触设备密钥。
- 使用系统浏览器完成 OAuth Authorization Code + PKCE；成功后自动配对设备。
- 设备密钥保存在 Windows 凭据管理器，不写入 WebView `localStorage`、日志或 URL。
- 原生层使用设备凭证读取当前用户自己的知识会话，本地 WebView 只接收会话和卡片数据。
- 首次启动为当前 Windows 用户注册 Chrome Native Messaging Host，并通过扩展心跳显示真实连接状态。
- 浮窗明确显示“采集关闭 / 正在验证 / 等待授权 / 错误”，唤醒不等于自动授权采集。
- 第二次启动由单实例插件转交给现有窗口，并恢复、显示和聚焦该窗口。
- 同一可执行文件提供 Chrome Native Messaging 帧协议和 Claude Code 单次 JSON Hook 桥接；两者只允许唤醒、授权/撤销和完整轮次提交。

## 边界

- 复用 `https://knowledge-copilot.xyz` 的 API、数据和域名。
- 驾驶舱不加载远程 iframe，CSP 设置 `frame-src 'none'`；“完整面板”由用户主动在系统浏览器中打开。
- 桌面外壳拥有窗口控制、固定域名 HTTPS 唤醒交换和 Windows 凭据管理能力。
- 配对设备只有 `capture:write` 和 `knowledge:read`，不能修改知识、管理设备或读取其他账号的数据。
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

首次启动后依次完成账号登录、选择 ChatGPT 网页版、安装扩展和连接确认。在 ChatGPT 某个对话点击“知”并确认“从现在开始沉淀”后，桌面驾驶舱自动显示该对话对应的知识会话；切换到其他已开启对话时自动切换，进入未开启页面时收起。点击图钉可保持展开，点击“完整面板”在系统浏览器中进行更完整的管理。会话 ID 只保存在当前 Windows 用户的 WebView 本地存储中；设备令牌只保存在 Windows 凭据管理器。

当前个人 Beta 的浏览器登录和设备配对代码已经完成。发布前仍需配置 Auth0 Native Application、Chrome Web Store 固定扩展 ID、代码签名、自动更新和崩溃遥测，并完成真实 ChatGPT 多会话与断网恢复验收。未签名安装包可能触发 Windows SmartScreen 提示。
