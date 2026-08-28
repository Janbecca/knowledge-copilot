import { getCurrentWindow, LogicalSize, type PhysicalSize } from "@tauri-apps/api/window";
import "./style.css";

const DEFAULT_ORIGIN = "https://knowledge-copilot.xyz";
const root = document.querySelector<HTMLDivElement>("#app")!;
const hasTauri = "__TAURI_INTERNALS__" in window;
const nativeWindow = hasTauri ? getCurrentWindow() : undefined;
let compact = false;
let previousSize: PhysicalSize | null = null;
let pinned = localStorage.getItem("kc-desktop-pinned") !== "false";

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
          <span class="session-label">${sessionId ? `会话 ${escapeHtml(sessionId)}` : "使用面板最近一次会话"}</span>
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
