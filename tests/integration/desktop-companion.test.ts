import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = "apps/desktop-companion";

describe("desktop companion contract", () => {
  it("ships an always-on-top resizable window with least-privilege controls", async () => {
    const config = JSON.parse(await readFile(`${root}/src-tauri/tauri.conf.json`, "utf8"));
    const window = config.app.windows[0];
    expect(window).toMatchObject({ label: "main", alwaysOnTop: true, decorations: false, resizable: true });
    expect(config.app.security.csp).toContain("frame-src 'none'");

    const capability = JSON.parse(await readFile(`${root}/src-tauri/capabilities/desktop-window.json`, "utf8"));
    expect(capability.windows).toEqual(["main"]);
    expect(capability.permissions).toContain("core:window:allow-start-dragging");
    expect(capability.permissions).toContain("core:window:allow-set-always-on-top");
    expect(capability.permissions.join("\n")).not.toMatch(/shell|filesystem|http:/i);
  });

  it("renders the cockpit locally and opens the full HTTPS panel only on demand", async () => {
    const source = await readFile(`${root}/src/main.ts`, "utf8");
    expect(source).toContain('const DEFAULT_ORIGIN = "https://knowledge-copilot.xyz"');
    expect(source).toContain('invoke<DesktopSessionState>("get_desktop_session"');
    expect(source).toContain('id="open-web-panel"');
    expect(source).toContain("window.setInterval");
    expect(source).toContain("8_000");
    expect(source).toContain("void loadCockpit(true)");
    expect(source).not.toContain("<iframe");
    expect(source).not.toContain('url.searchParams.set("desktop", "1")');

    const nativeSource = await readFile(`${root}/src-tauri/src/lib.rs`, "utf8");
    expect(nativeSource).toContain("async fn get_desktop_session");
    expect(nativeSource).toContain('.get(format!("{API_ORIGIN}/api/sessions/{session_id}"))');
  });

  it("guides first-time users through login, ChatGPT selection, extension connection, and launch", async () => {
    const source = await readFile(`${root}/src/main.ts`, "utf8");
    expect(source).toContain("登录 Knowledge Copilot");
    expect(source).toContain("选择第一个 AI 工具");
    expect(source).toContain("安装 Chrome 扩展");
    expect(source).toContain("ChatGPT 网页版已连接");
    expect(source).toContain("extension_connection_status");
    expect(source).toContain("begin_oauth_login");
    expect(source).toContain("complete_oauth_login");
    expect(source).not.toContain("我已完成登录");
    expect(source).toContain("打开 ChatGPT 开启第一次知识沉淀");

    const nativeSource = await readFile(`${root}/src-tauri/src/lib.rs`, "utf8");
    expect(nativeSource).toContain('message.message_type == "extension_hello"');
    expect(nativeSource).toContain("chrome-extension-connected");
    expect(nativeSource).toContain('const OAUTH_REDIRECT_URI: &str = "knowledge-copilot://auth/callback"');
    expect(nativeSource).toContain("code_challenge_method");
    expect(nativeSource).toContain("native_host_registration_status");
    expect(nativeSource).toContain("/api/conversation-bindings/capture");
    const captureBranch = nativeSource.slice(nativeSource.indexOf('"capture_turn"'), nativeSource.indexOf('_ => Err("unsupported native message type"'));
    expect(captureBranch).not.toContain("active-capture-route");
  });

  it("passes the dedicated desktop OAuth client through the production container", async () => {
    const compose = await readFile("compose.yaml", "utf8");
    expect(compose).toContain("KNOWLEDGE_COPILOT_OIDC_DESKTOP_CLIENT_ID: ${KNOWLEDGE_COPILOT_OIDC_DESKTOP_CLIENT_ID:-}");
  });
});
