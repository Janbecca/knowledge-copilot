import { getCurrentWindow, LogicalSize, type PhysicalSize } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import "./style.css";
import "./security.css";

const DEFAULT_ORIGIN = "https://knowledge-copilot.xyz";
const root = document.querySelector<HTMLDivElement>("#app")!;
const hasTauri = "__TAURI_INTERNALS__" in window;
const nativeWindow = hasTauri ? getCurrentWindow() : undefined;
let compact = false;
let previousSize: PhysicalSize | null = null;
let pinned = localStorage.getItem("kc-desktop-pinned") !== "false";
let paired = false;
let wakeState: "idle" | "opening" | "ready" | "error" = "idle";
let wakeMessage = "采集关闭";

function safeOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("HTTPS required");
    return url.origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

const origin = safeOrigin(localStorage.getItem("kc-desktop-origin") ?? DEFAULT_ORIGIN);
let sessionId = localStorage.getItem("kc-desktop-session")?.trim() ?? "";

function panelUrl(): string {
  const url = new URL("/app/", origin);
  url.searchParams.set("desktop", "1");
  if (sessionId) url.searchParams.set("session", sessionId);
  return url.toString();
}

function render(): void {
  root.innerHTML = `
    <main class="companion ${compact ? "is-compact" : ""}">
      <section class="orb" data-tauri-drag-region aria-label="Knowledge Copilot 已最小化">
        <span data-tauri-drag-region>知</span>
        <button id="restore" title="展开浮窗" aria-label="展开浮窗">↗</button>
      </section>
      <section class="window-shell">
        <header class="titlebar" data-tauri-drag-region>
          <div class="brand" data-tauri-drag-region>
            <span class="brand-mark" data-tauri-drag-region>知</span>
            <div data-tauri-drag-region>
              <strong data-tauri-drag-region>Knowledge Copilot</strong>
              <small id="connection" data-tauri-drag-region>${navigator.onLine ? "在线同步" : "等待网络"}</small>
            </div>
          </div>
          <div class="window-actions">
            <button id="pin" class="${pinned ? "active" : ""}" title="${pinned ? "取消置顶" : "始终置顶"}" aria-label="切换置顶">⌖</button>
            <button id="compact" title="收起为悬浮球" aria-label="收起为悬浮球">●</button>
            <button id="minimize" title="最小化" aria-label="最小化">—</button>
            <button id="close" title="关闭" aria-label="关闭">×</button>
          </div>
        </header>
        <div class="sessionbar">
          <div class="session-summary">
            <span class="capture-state ${wakeState}"><i></i>${escapeHtml(wakeMessage)}</span>
            <span class="session-label">${sessionId ? `会话 ${escapeHtml(sessionId)}` : "使用面板最近一次会话"}</span>
          </div>
          <div>
            <button id="reload" title="刷新笔记">刷新</button>
            <button id="settings" title="切换会话">会话</button>
          </div>
        </div>
        <section id="settings-sheet" class="settings-sheet" hidden>
          <label for="session-id">打开指定会话</label>
          <div class="settings-row">
            <input id="session-id" value="${escapeAttribute(sessionId)}" placeholder="session_xxx；留空使用最近会话">
            <button id="save-session">打开</button>
          </div>
          <p>服务器：${escapeHtml(origin)}</p>
          <hr>
          <label for="device-token">桌面设备配对</label>
          <p>${paired ? "已安全保存到 Windows 凭据管理器。令牌不会写入网页存储。" : "在账号安全页创建设备后，将仅显示一次的设备令牌粘贴到这里。"}</p>
          <div class="settings-row">
            <input id="device-token" type="password" autocomplete="off" placeholder="kc_device_…">
            <button id="save-device">${paired ? "替换" : "配对"}</button>
            ${paired ? '<button id="clear-device" class="secondary">解除</button>' : ""}
          </div>
        </section>
        <div class="panel-wrap">
          <div id="loading" class="loading"><span></span>正在连接知识面板…</div>
          <iframe id="panel" title="Knowledge Copilot 知识面板" src="${escapeAttribute(panelUrl())}" sandbox="allow-scripts allow-forms allow-same-origin allow-popups"></iframe>
        </div>
      </section>
    </main>`;
  bind();
}

function escapeHtml(value: string): string {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

async function native(action: (target: ReturnType<typeof getCurrentWindow>) => Promise<unknown>): Promise<void> {
  if (!nativeWindow) return;
  try { await action(nativeWindow); } catch (error) { console.error(error); }
}

function bind(): void {
  const iframe = document.querySelector<HTMLIFrameElement>("#panel")!;
  iframe.addEventListener("load", () => document.querySelector("#loading")?.classList.add("hidden"));
  document.querySelector("#reload")?.addEventListener("click", () => {
    document.querySelector("#loading")?.classList.remove("hidden");
    iframe.src = panelUrl();
  });
  document.querySelector("#settings")?.addEventListener("click", () => {
    const sheet = document.querySelector<HTMLElement>("#settings-sheet")!;
    sheet.hidden = !sheet.hidden;
    if (!sheet.hidden) document.querySelector<HTMLInputElement>("#session-id")?.focus();
  });
  document.querySelector("#save-session")?.addEventListener("click", () => {
    sessionId = document.querySelector<HTMLInputElement>("#session-id")!.value.trim();
    if (sessionId) localStorage.setItem("kc-desktop-session", sessionId);
    else localStorage.removeItem("kc-desktop-session");
    render();
  });
  document.querySelector("#save-device")?.addEventListener("click", () => void saveDevice());
  document.querySelector("#clear-device")?.addEventListener("click", () => void clearDevice());
  document.querySelector("#pin")?.addEventListener("click", () => void native(async (target) => {
    pinned = !pinned;
    await target.setAlwaysOnTop(pinned);
    localStorage.setItem("kc-desktop-pinned", String(pinned));
    render();
  }));
  document.querySelector("#minimize")?.addEventListener("click", () => void native((target) => target.minimize()));
  document.querySelector("#close")?.addEventListener("click", () => void native((target) => target.close()));
  document.querySelector("#compact")?.addEventListener("click", () => void setCompact(true));
  document.querySelector("#restore")?.addEventListener("click", () => void setCompact(false));
}

async function saveDevice(): Promise<void> {
  const field = document.querySelector<HTMLInputElement>("#device-token")!;
  const token = field.value.trim();
  if (!hasTauri) { wakeState = "error"; wakeMessage = "请在桌面应用中配对"; render(); return; }
  try {
    await invoke("save_device_credential", { deviceToken: token });
    field.value = ""; paired = true; wakeState = "idle"; wakeMessage = "设备已配对 · 采集关闭"; render();
  } catch (error) { wakeState = "error"; wakeMessage = String(error); render(); }
}

async function clearDevice(): Promise<void> {
  if (!hasTauri) return;
  try { await invoke("clear_device_credential"); paired = false; wakeState = "idle"; wakeMessage = "设备未配对 · 采集关闭"; render(); }
  catch (error) { wakeState = "error"; wakeMessage = String(error); render(); }
}

async function handleDeepLink(raw: string): Promise<void> {
  let url: URL;
  try { url = new URL(raw); } catch { return; }
  if (url.protocol !== "knowledge-copilot:") return;
  if (url.hostname === "open") {
    await native(async target => { await target.show(); await target.unminimize(); await target.setFocus(); });
    wakeState = "idle"; wakeMessage = paired ? "设备已配对 · 采集关闭" : "设备未配对 · 采集关闭"; render(); return;
  }
  if (url.hostname !== "wake") return;
  const token = url.searchParams.get("token") ?? "";
  if (!/^kc_wake_[A-Za-z0-9_-]{32,152}$/.test(token)) { wakeState = "error"; wakeMessage = "唤醒链接格式无效"; render(); return; }
  await native(async target => { await target.show(); await target.unminimize(); await target.setFocus(); });
  wakeState = "opening"; wakeMessage = "正在验证一次性唤醒请求…"; render();
  try {
    const intent = await invoke<{ session_id: string | null; source_host: string }>("consume_wake_token", { wakeToken: token });
    if (intent.session_id) { sessionId = intent.session_id; localStorage.setItem("kc-desktop-session", sessionId); }
    wakeState = "ready"; wakeMessage = `${intent.source_host} 已唤醒 · 等待采集授权`; render();
  } catch (error) { wakeState = "error"; wakeMessage = String(error); render(); }
}

async function initializeNative(): Promise<void> {
  if (!hasTauri) return;
  try { paired = await invoke<boolean>("device_is_paired"); wakeMessage = paired ? "设备已配对 · 采集关闭" : "设备未配对 · 采集关闭"; render(); }
  catch { paired = false; }
  await onOpenUrl(urls => { for (const url of urls) void handleDeepLink(url); });
  for (const url of await getCurrent() ?? []) await handleDeepLink(url);
}

async function setCompact(next: boolean): Promise<void> {
  if (next === compact) return;
  if (nativeWindow) {
    if (next) {
      previousSize = await nativeWindow.innerSize();
      await nativeWindow.setSize(new LogicalSize(86, 86));
    } else {
      const scale = await nativeWindow.scaleFactor();
      await nativeWindow.setSize(previousSize ? previousSize.toLogical(scale) : new LogicalSize(420, 720));
    }
  }
  compact = next;
  render();
}

window.addEventListener("online", render);
window.addEventListener("offline", render);
render();
void initializeNative();
