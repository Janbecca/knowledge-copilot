import { App } from "@modelcontextprotocol/ext-apps";
import { UserManager, WebStorageStateStore } from "oidc-client-ts";
import "./style.css";
import "./security.css";

type ExtractionMode = "host_structured" | "server_llm";
type Card = any;
type State = {
  session: {
    session_id: string;
    title: string;
    status: "active" | "paused" | "ended";
    extraction_mode: ExtractionMode;
    capture_scope: { mode: "all" | "topic"; topic: string | null };
  };
  cursor: number;
  cards: Card[];
  learning_debts: Card[];
  recent_cards?: Card[];
  desktop?: DesktopWake;
};
type DesktopWake = { status: "ready" | "not_paired"; deep_link?: string; expires_at?: string; install_url: string };

const root = document.querySelector<HTMLDivElement>("#app")!;
const query = new URLSearchParams(location.search);
let state: State | null = null;
let sessionId = query.get("session") ?? localStorage.getItem("kc-session") ?? "";
let since = Number(localStorage.getItem(`kc-seen-${sessionId}`) ?? 0);
let filter = "all";
let embedded = false;
let mcp: App | null = null;
let errorMessage = "";
let authEnabled = false;
let accessToken = "";
let userManager: UserManager | null = null;
let devices: Array<{ device_id: string; name: string; platform: string; last_seen_at: string; revoked_at: string | null }> = [];
let oneTimeDeviceToken = "";

const host = () => (window as any).openai as {
  requestDisplayMode?: (input: { mode: "inline" | "pip" | "fullscreen" }) => Promise<unknown>;
  openExternal?: (input: { href: string; redirectUrl?: boolean }) => Promise<unknown>;
  setOpenInAppUrl?: (input: { href: string }) => void;
} | undefined;

const standaloneUrl = () => `https://knowledge-copilot.xyz/app/?session=${encodeURIComponent(sessionId)}`;

async function requestMode(mode: "inline" | "pip" | "fullscreen") {
  const api = host();
  if (!api?.requestDisplayMode) throw new Error("当前 ChatGPT 客户端不支持此显示模式");
  await api.requestDisplayMode({ mode });
}

async function openStandalone() {
  const href = standaloneUrl();
  const api = host();
  if (api?.openExternal) {
    await api.openExternal({ href, redirectUrl: false });
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}

async function openDesktopIntent(intent: DesktopWake) {
  if (intent.status !== "ready" || !intent.deep_link) {
    const api = host();
    if (api?.openExternal) await api.openExternal({ href: intent.install_url, redirectUrl: false });
    else window.open(intent.install_url, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    const api = host();
    if (api?.openExternal) await api.openExternal({ href: intent.deep_link, redirectUrl: false });
    else location.href = intent.deep_link;
  } catch {
    const api = host();
    if (api?.openExternal) await api.openExternal({ href: intent.install_url, redirectUrl: false });
    else window.open(intent.install_url, "_blank", "noopener,noreferrer");
  }
}

function esc(value: string) {
  const element = document.createElement("div");
  element.textContent = value ?? "";
  return element.innerHTML;
}

function attr(value: string) {
  return esc(value).replace(/"/g, "&quot;");
}

function eventLabel(card: Card) {
  if (card.lifecycle === "superseded") return "已替换";
  if (card.lifecycle === "discarded") return "已废弃";
  if (card.revision > 1) return "已修订";
  return card.revision === 1 ? "新增" : "";
}

function cardView(card: Card) {
  return `<details class="card ${card.lifecycle} revision-${card.revision}">
    <summary><span class="kind">${card.type}</span><b>${esc(card.title)}</b><span class="event">${eventLabel(card)}</span></summary>
    <p>${esc(card.summary)}</p>
    ${card.operation ? `<dl><dt>实际作用</dt><dd>${esc(card.operation.actual_effect)}</dd><dt>目的</dt><dd>${esc(card.operation.current_purpose)}</dd><dt>机制</dt><dd>${esc(card.operation.mechanism)}</dd><dt>验证</dt><dd>${esc(card.operation.verification.join("；"))}</dd><dt>风险</dt><dd>${esc(card.operation.risks.join("；"))}</dd><dt>可逆性</dt><dd>${card.operation.reversibility}</dd></dl>` : ""}
    ${card.learning_debt ? `<p class="debt">${esc(card.learning_debt.question)} · ${card.learning_debt.recommended_stage}</p>` : ""}
    <div class="sources">来源：${card.provenance.map((item: any) => esc(item.turn_ref)).join("、")}</div>
    <button data-status="mastered" data-id="${card.card_id}">已掌握</button>
    <button data-status="review" data-id="${card.card_id}">待复习</button>
  </details>`;
}

function errorView() {
  return errorMessage ? `<p class="error" role="alert">${esc(errorMessage)}</p>` : "";
}

function modeChooser(selected: ExtractionMode, location: "create" | "session") {
  const label = location === "create" ? "创建模式" : "提取方式";
  return `<div class="mode-card" aria-label="${label}">
    <div class="mode-options">
      <button type="button" data-mode="host_structured" class="${selected === "host_structured" ? "selected" : ""}">
        <b>当前 AI 直接整理</b><small>不额外调用模型，AI 提交结构化知识点</small>
      </button>
      <button type="button" data-mode="server_llm" class="${selected === "server_llm" ? "selected" : ""}">
        <b>服务器 LLM</b><small>将脱敏后的本轮对话交给自配模型提取</small>
      </button>
    </div>
  </div>`;
}

function debugCaptureView(mode: ExtractionMode) {
  const structured = mode === "host_structured";
  return `<details>
    <summary>开发调试：提交一轮</summary>
    <form id="capture">
      <p class="mode-help">${structured
        ? "正常使用时由当前对话 AI 自动提交。手工测试可填写下方结构化知识点 JSON。"
        : "本轮原文会在本地脱敏后发送给服务器配置的 LLM。"}</p>
      <textarea id="user" placeholder="用户消息" required></textarea>
      <textarea id="assistant" placeholder="助手消息" required></textarea>
      ${structured ? `<textarea id="knowledge-items" class="code-input" placeholder='[{"type":"concept","title":"标题","summary":"摘要"}]' required></textarea>` : ""}
      <button>捕获完成轮次</button>
    </form>
  </details>`;
}

function render() {
  if (!embedded && authEnabled && !accessToken) {
    root.innerHTML = `<main class="welcome"><h1>登录知识驾驶舱</h1><p>登录后才能访问属于你的学习会话、配对设备和授权记录。</p>${errorView()}<button id="login">使用账号登录</button><p class="mode-help">登录通过标准 OAuth/OIDC PKCE 完成；桌面设备令牌不会保存在网页存储中。</p></main>`;
    bind(); return;
  }
  if (!state) {
    const initialMode = (localStorage.getItem("kc-new-mode") as ExtractionMode | null) ?? "host_structured";
    root.innerHTML = `<main class="welcome">
      <h1>对话知识副驾驶</h1>
      <p>创建或输入会话 ID。面板只显示显式捕获并持久化的数据。</p>
      ${errorView()}
      <form id="start">
        <input id="title" placeholder="会话标题（可选）">
        ${modeChooser(initialMode, "create")}
        <input id="initial-mode" type="hidden" value="${initialMode}">
        <button>创建会话</button>
      </form>
      <form id="open"><input id="sid" placeholder="session_id"><button>打开</button></form>
      ${deviceManagerView()}
      ${!embedded && authEnabled ? '<button id="logout">退出账号</button>' : ""}
    </main>`;
    bind();
    return;
  }

  const mode = state.session.extraction_mode;
  const all = state.cards.filter(card => filter === "all" || card.type === filter);
  const fresh = (state.recent_cards ?? []).filter(card => (filter === "all" || card.type === filter) && card.lifecycle === "active");
  root.innerHTML = `<main>
    ${errorView()}
    <header>
      <div>
        <p class="eyebrow">REAL CURSOR ${state.cursor}</p>
        <form id="rename" class="rename"><input id="rename-title" value="${attr(state.session.title)}" aria-label="会话标题"><button>改名</button></form>
        <p class="session-id">${esc(state.session.session_id)}</p>
        <p>${state.session.status} · ${esc(state.session.capture_scope.topic ?? "全部主题")}</p>
      </div>
      <div class="panel-actions"><button id="desktop">桌面驾驶舱</button><button id="pip">悬浮</button><button id="fullscreen">全屏</button><button id="external">新窗口</button><button id="toggle">${state.session.status === "active" ? "暂停" : "恢复"}</button><button id="refresh">刷新</button>${!embedded && authEnabled ? '<button id="logout">退出</button>' : ""}</div>
    </header>
    <section class="mode-section">
      <div><p class="eyebrow dark">EXTRACTION MODE</p><h2>知识提取方式</h2></div>
      ${modeChooser(mode, "session")}
      <p class="mode-help">${mode === "host_structured"
        ? "当前对话 AI 负责理解和整理，服务器只校验与保存，不产生第二次模型调用。"
        : "服务器使用你配置的 LLM 处理脱敏后的原始对话；会产生 API 调用费用。"}</p>
    </section>
    <nav>${["all", "concept", "principle", "method", "operation", "framework", "correction", "learning_debt"].map(type => `<button data-filter="${type}" class="${filter === type ? "active" : ""}">${type}</button>`).join("")}</nav>
    <section><h2>本轮新增 <span>${fresh.length}</span></h2><div class="grid">${fresh.map(cardView).join("") || "<p class=empty>等待下一轮已授权的知识捕获。</p>"}</div><button id="mark-seen">只看新增边界标记为 ${state.cursor}</button></section>
    <section><h2>全部知识</h2><div class="grid">${all.map(cardView).join("") || "<p class=empty>暂无卡片。完成一轮有实质信息的问答后将自动沉淀。</p>"}</div></section>
    <section><h2>待深挖</h2>${state.learning_debts.map(cardView).join("") || "<p class=empty>暂无学习债务。</p>"}</section>
    <section><h2>笔记与思维导图</h2><div class="exports"><button data-export="markdown">Markdown 笔记</button><button data-export="mermaid">Mermaid 思维导图</button><button data-export="json">JSON 完整导出</button></div><pre id="export"></pre></section>
    ${debugCaptureView(mode)}
    ${deviceManagerView()}
  </main>`;
  bind();
}

async function call(name: string, args: any) {
  if (embedded && mcp) {
    const response = await mcp.callServerTool({ name, arguments: args });
    const text = (response.content as any[])?.find(item => item.type === "text")?.text;
    const parsed = text ? JSON.parse(text) : response.structuredContent;
    if (response.isError) throw new Error(parsed?.error?.message ?? "操作失败");
    return parsed;
  }
  const routes: Record<string, [string, string]> = {
    start_learning_session: ["/api/sessions", "POST"],
    rename_learning_session: [`/api/sessions/${args.session_id}/title`, "POST"],
    capture_conversation_turn: [`/api/sessions/${args.session_id}/capture`, "POST"],
    get_learning_session: [`/api/sessions/${args.session_id}`, "GET"],
    list_knowledge_cards: [`/api/sessions/${args.session_id}/cards?since_cursor=${args.since_cursor ?? 0}&include_inactive=${args.include_inactive ?? false}`, "GET"],
    change_capture_status: [`/api/sessions/${args.session_id}/status`, "POST"],
    change_extraction_mode: [`/api/sessions/${args.session_id}/extraction-mode`, "POST"],
    change_card_learning_status: [`/api/cards/${args.card_id}/status`, "POST"],
    export_learning_package: [`/api/sessions/${args.session_id}/export/${args.format}`, "GET"],
    wake_desktop_copilot: [`/api/sessions/${args.session_id}/wake`, "POST"],
  };
  const [url, method] = routes[name];
  const payload = { ...args };
  delete payload.session_id;
  delete payload.card_id;
  delete payload.format;
  const headers: Record<string,string> = { "content-type": "application/json" };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  const response = await fetch(url, { method, headers, body: method === "GET" ? undefined : JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "操作失败");
  return result;
}

async function load() {
  if (!sessionId) {
    state = null;
    render();
    return;
  }
  state = await call("get_learning_session", { session_id: sessionId });
  const recent = await call("list_knowledge_cards", { session_id: sessionId, since_cursor: since, include_inactive: true });
  state!.recent_cards = recent.cards;
  localStorage.setItem("kc-session", sessionId);
  render();
}

async function act(operation: () => Promise<void>) {
  errorMessage = "";
  try {
    await operation();
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "操作失败";
    render();
  }
}

function bind() {
  document.querySelector("#login")?.addEventListener("click", () => void act(async () => { await userManager?.signinRedirect(); }));
  document.querySelector("#logout")?.addEventListener("click", () => void act(async () => { accessToken = ""; await userManager?.signoutRedirect(); }));
  document.querySelector("#dismiss-token")?.addEventListener("click", () => { oneTimeDeviceToken = ""; render(); });
  document.querySelector<HTMLFormElement>("#pair-device")?.addEventListener("submit", event => {
    event.preventDefault(); void act(async () => {
      const response = await authenticatedFetch("/api/devices/pair", { method: "POST", body: JSON.stringify({ name: document.querySelector<HTMLInputElement>("#device-name")!.value.trim(), platform: "windows" }) });
      const result = await response.json() as { device_token: string };
      oneTimeDeviceToken = result.device_token; await loadDevices(); render();
    });
  });
  document.querySelectorAll<HTMLElement>("[data-revoke-device]").forEach(button => {
    button.onclick = () => void act(async () => { await authenticatedFetch(`/api/devices/${button.dataset.revokeDevice}`, { method: "DELETE" }); await loadDevices(); render(); });
  });
  document.querySelector<HTMLFormElement>("#start")?.addEventListener("submit", event => {
    event.preventDefault();
    void act(async () => {
      const title = document.querySelector<HTMLInputElement>("#title")!.value.trim() || undefined;
      const extractionMode = document.querySelector<HTMLInputElement>("#initial-mode")!.value as ExtractionMode;
      const session = await call("start_learning_session", { title, extraction_mode: extractionMode, source_host: embedded ? "mcp-app" : "preview" });
      sessionId = session.session_id;
      since = 0;
      await load();
    });
  });
  document.querySelector<HTMLFormElement>("#open")?.addEventListener("submit", event => {
    event.preventDefault();
    void act(async () => {
      sessionId = document.querySelector<HTMLInputElement>("#sid")!.value.trim();
      since = Number(localStorage.getItem(`kc-seen-${sessionId}`) ?? 0);
      await load();
    });
  });
  document.querySelector<HTMLFormElement>("#rename")?.addEventListener("submit", event => {
    event.preventDefault();
    void act(async () => {
      await call("rename_learning_session", { session_id: sessionId, title: document.querySelector<HTMLInputElement>("#rename-title")!.value });
      await load();
    });
  });
  document.querySelectorAll<HTMLElement>("[data-mode]").forEach(button => {
    button.onclick = () => void act(async () => {
      const extractionMode = button.dataset.mode as ExtractionMode;
      if (!state) {
        localStorage.setItem("kc-new-mode", extractionMode);
        document.querySelector<HTMLInputElement>("#initial-mode")!.value = extractionMode;
        render();
        return;
      }
      if (extractionMode === state.session.extraction_mode) return;
      await call("change_extraction_mode", { session_id: sessionId, extraction_mode: extractionMode });
      await load();
    });
  });
  document.querySelector("#pip")?.addEventListener("click", () => void act(() => requestMode("pip")));
  document.querySelector("#fullscreen")?.addEventListener("click", () => void act(() => requestMode("fullscreen")));
  document.querySelector("#external")?.addEventListener("click", () => void act(openStandalone));
  document.querySelector("#desktop")?.addEventListener("click", () => void act(async () => openDesktopIntent(await call("wake_desktop_copilot", { session_id: sessionId, source_host: embedded ? "chatgpt" : "web" }))));
  document.querySelector("#refresh")?.addEventListener("click", () => void act(load));
  document.querySelector("#toggle")?.addEventListener("click", () => void act(async () => {
    await call("change_capture_status", { session_id: sessionId, status: state!.session.status === "active" ? "paused" : "active" });
    await load();
  }));
  document.querySelector("#mark-seen")?.addEventListener("click", () => {
    since = state!.cursor;
    localStorage.setItem(`kc-seen-${sessionId}`, String(since));
    render();
  });
  document.querySelectorAll<HTMLElement>("[data-filter]").forEach(button => {
    button.onclick = () => { filter = button.dataset.filter!; render(); };
  });
  document.querySelectorAll<HTMLElement>("[data-status]").forEach(button => {
    button.onclick = () => void act(async () => {
      await call("change_card_learning_status", { card_id: button.dataset.id, status: button.dataset.status });
      await load();
    });
  });
  document.querySelectorAll<HTMLElement>("[data-export]").forEach(button => {
    button.onclick = () => void act(async () => {
      const exported = await call("export_learning_package", { session_id: sessionId, format: button.dataset.export });
      document.querySelector("#export")!.textContent = exported.content;
    });
  });
  document.querySelector<HTMLFormElement>("#capture")?.addEventListener("submit", event => {
    event.preventDefault();
    void act(async () => {
      const payload: Record<string, unknown> = {
        session_id: sessionId,
        user_message: document.querySelector<HTMLTextAreaElement>("#user")!.value,
        assistant_message: document.querySelector<HTMLTextAreaElement>("#assistant")!.value,
        source_reference: `preview-${Date.now()}`,
      };
      if (state!.session.extraction_mode === "host_structured") {
        payload.knowledge_items = JSON.parse(document.querySelector<HTMLTextAreaElement>("#knowledge-items")!.value);
      }
      await call("capture_conversation_turn", payload);
      await load();
    });
  });
}

function deviceManagerView() {
  if (embedded || !authEnabled) return "";
  return `<section class="security-card"><p class="eyebrow dark">ACCOUNT SECURITY</p><h2>桌面设备</h2><p class="mode-help">设备令牌只显示一次。复制后粘贴到桌面浮窗“会话 → 桌面设备配对”，它会进入 Windows 凭据管理器。</p>
    ${oneTimeDeviceToken ? `<div class="one-time-token"><b>请立即复制，关闭后不再显示</b><code>${esc(oneTimeDeviceToken)}</code><button id="dismiss-token">我已保存</button></div>` : ""}
    <form id="pair-device" class="device-form"><input id="device-name" placeholder="例如：我的 Windows 电脑" required maxlength="80"><button>创建设备</button></form>
    <div class="device-list">${devices.map(device => `<div><span><b>${esc(device.name)}</b><small>${esc(device.platform)} · ${device.revoked_at ? "已撤销" : "有效"}</small></span>${device.revoked_at ? "" : `<button data-revoke-device="${attr(device.device_id)}">撤销</button>`}</div>`).join("") || "<p class=empty>尚未配对桌面设备。</p>"}</div>
  </section>`;
}

async function authenticatedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers); headers.set("content-type", "application/json");
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) { const result = await response.json().catch(() => ({})) as { error?: string }; throw new Error(result.error ?? `请求失败（${response.status}）`); }
  return response;
}

async function loadDevices(): Promise<void> {
  if (!accessToken) return;
  const response = await authenticatedFetch("/api/devices");
  devices = ((await response.json()) as { devices: typeof devices }).devices;
}

async function initializeStandaloneAuth(): Promise<void> {
  const response = await fetch("/api/auth/config", { headers: { accept: "application/json" } });
  const config = await response.json() as { enabled: boolean; authority?: string; client_id?: string; audience?: string; scope?: string };
  authEnabled = config.enabled;
  if (!config.enabled || !config.authority || !config.client_id) return;
  userManager = new UserManager({
    authority: config.authority,
    client_id: config.client_id,
    redirect_uri: `${location.origin}/app/`,
    post_logout_redirect_uri: `${location.origin}/app/`,
    response_type: "code",
    scope: config.scope,
    extraQueryParams: config.audience ? { audience: config.audience } : undefined,
    userStore: new WebStorageStateStore({ store: sessionStorage }),
  });
  if (query.has("code") && query.has("state")) {
    await userManager.signinRedirectCallback();
    history.replaceState({}, document.title, "/app/");
  }
  const user = await userManager.getUser();
  if (user && !user.expired) { accessToken = user.access_token; await loadDevices(); }
}

embedded = window.parent !== window && query.get("desktop") !== "1";
if (embedded) {
  try {
    mcp = new App({ name: "Knowledge Copilot Panel", version: "0.4.0" });
    mcp.ontoolresult = response => {
      const text = (response.content as any[])?.find(item => item.type === "text")?.text;
      if (!text) return;
      const parsed = JSON.parse(text);
      if (!parsed.session) return;
      state = parsed;
      sessionId = parsed.session.session_id;
      localStorage.setItem("kc-session", sessionId);
      host()?.setOpenInAppUrl?.({ href: standaloneUrl() });
      render();
      if (parsed.desktop) void openDesktopIntent(parsed.desktop);
    };
    await mcp.connect();
    await requestMode("pip").catch(() => undefined);
  } catch {
    embedded = false;
    mcp = null;
  }
}
if (!embedded) await initializeStandaloneAuth();
await act(load);
window.setInterval(() => {
  if (embedded && sessionId && document.visibilityState !== "hidden") void act(load);
}, 8000);
