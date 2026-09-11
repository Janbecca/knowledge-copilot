import { getCurrentWindow, LogicalSize, type PhysicalSize } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import "./style.css";
import "./cockpit.css";
import "./security.css";

const DEFAULT_ORIGIN = "https://knowledge-copilot.xyz";
const CHATGPT_URL = "https://chatgpt.com/";
const CHROME_STORE_URL = "https://chromewebstore.google.com/";
const ONBOARDING_STEP_KEY = "kc-onboarding-step";
const ONBOARDING_COMPLETE_KEY = "kc-onboarding-complete";

type OnboardingStep = 1 | 2 | 3 | 4;
type ExtensionState = "idle" | "checking" | "connected" | "stale" | "error";
type LoginState = "idle" | "opening" | "waiting" | "authenticated" | "error";
type ExtensionConnection = { connected: boolean; status: string; version?: string; browser?: string; last_seen_at?: number };
type NativeHostRegistration = { configured: boolean; extension_id?: string; store_url: string; message: string };
type DesktopCard = { card_id: string; type: string; title: string; summary: string; lifecycle: string; revision: number; learning_status: string };
type DesktopSessionState = {
  session: { session_id: string; title: string; status: "active" | "paused" | "ended"; extraction_mode: string };
  cursor: number;
  cards: DesktopCard[];
  learning_debts: DesktopCard[];
};

const root = document.querySelector<HTMLDivElement>("#app")!;
const hasTauri = "__TAURI_INTERNALS__" in window;
const nativeWindow = hasTauri ? getCurrentWindow() : undefined;
let compact = false;
let previousSize: PhysicalSize | null = null;
let pinned = localStorage.getItem("kc-desktop-pinned") === "true";
let paired = false;
let wakeState: "idle" | "opening" | "ready" | "error" = "idle";
let wakeMessage = "采集关闭";
let onboardingStep = storedStep();
let onboardingComplete = localStorage.getItem(ONBOARDING_COMPLETE_KEY) === "true";
let extensionState: ExtensionState = "idle";
let extensionMessage = "正式版本将自动检测商店扩展和 Native Messaging。";
let loginState: LoginState = "idle";
let loginMessage = "登录不会自动读取任何 AI 对话。";
let cockpitData: DesktopSessionState | null = null;
let cockpitLoading = false;
let cockpitError = "";

function safeOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("HTTPS required");
    return url.origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

function storedStep(): OnboardingStep {
  const step = Number(localStorage.getItem(ONBOARDING_STEP_KEY) ?? 1);
  return step >= 1 && step <= 4 ? step as OnboardingStep : 1;
}

function setOnboardingStep(step: OnboardingStep): void {
  onboardingStep = step;
  localStorage.setItem(ONBOARDING_STEP_KEY, String(step));
  render();
}

const origin = safeOrigin(localStorage.getItem("kc-desktop-origin") ?? DEFAULT_ORIGIN);
let sessionId = localStorage.getItem("kc-desktop-session")?.trim() ?? "";

function webPanelUrl(): string {
  const url = new URL("/app/", origin);
  if (sessionId) url.searchParams.set("session", sessionId);
  return url.toString();
}

function render(): void {
  root.innerHTML = `
    <main class="companion ${compact ? "is-compact" : ""}">
      <section class="orb" data-tauri-drag-region aria-label="Knowledge Copilot 已最小化">
        <span data-tauri-drag-region>知</span>
        <button id="restore" aria-label="展开浮窗">展开</button>
      </section>
      <section class="window-shell">
        ${titlebarView()}
        ${shouldShowOnboarding() ? onboardingView() : cockpitView()}
      </section>
    </main>`;
  bindCommon();
  if (shouldShowOnboarding()) bindOnboarding(); else bindCockpit();
}

function shouldShowOnboarding(): boolean {
  return !onboardingComplete;
}

function titlebarView(): string {
  return `<header class="titlebar" data-tauri-drag-region>
    <div class="brand" data-tauri-drag-region>
      <span class="brand-mark" data-tauri-drag-region>知</span>
      <div data-tauri-drag-region><strong data-tauri-drag-region>Knowledge Copilot</strong><small id="connection" data-tauri-drag-region>${navigator.onLine ? "在线同步" : "等待网络"}</small></div>
    </div>
    <div class="window-actions">
      <button id="pin" class="${pinned ? "active" : ""}" aria-label="${pinned ? "取消置顶" : "始终置顶"}">置顶</button>
      <button id="compact" aria-label="收起为悬浮球">收起</button>
      <button id="minimize" aria-label="最小化">最小化</button>
      <button id="close" aria-label="关闭">关闭</button>
    </div>
  </header>`;
}

function progressView(): string {
  const labels = ["登录账号", "选择 AI 工具", "安装扩展", "完成"];
  return `<ol class="setup-progress" aria-label="首次使用进度">${labels.map((label, index) => {
    const step = index + 1;
    const status = step < onboardingStep ? "done" : step === onboardingStep ? "current" : "pending";
    return `<li class="${status}" ${step === onboardingStep ? 'aria-current="step"' : ""}><span>${step < onboardingStep ? "完成" : step}</span><small>${label}</small></li>`;
  }).join("")}</ol>`;
}

function onboardingView(): string {
  return `<section class="onboarding-shell">${progressView()}<div class="onboarding-content">${onboardingStepView()}</div></section>`;
}

function onboardingStepView(): string {
  if (onboardingStep === 1) {
    const authenticated = loginState === "authenticated";
    const busy = loginState === "opening" || loginState === "waiting";
    return `<div class="setup-copy"><p class="eyebrow">第一步</p><h1>登录 Knowledge Copilot</h1><p class="lead">账号用于同步你的学习会话、知识卡片和已连接设备。登录会在系统浏览器中完成。</p><div class="trust-note ${loginState === "error" ? "error" : ""}"><b>${authenticated ? "登录成功" : loginState === "error" ? "登录未完成" : "隐私说明"}</b><span>${escapeHtml(loginMessage)}</span></div><div class="setup-actions">${authenticated ? '<button id="login-next" class="primary">继续选择 AI 工具</button>' : `<button id="open-login" class="primary" ${busy ? "disabled" : ""}>${busy ? "等待浏览器登录…" : "使用浏览器登录"}</button>`}${loginState === "waiting" ? '<p class="inline-status">浏览器登录完成后会自动返回桌面端，无需手工确认。</p>' : ""}</div></div>`;
  }
  if (onboardingStep === 2) {
    return `<div class="setup-copy"><p class="eyebrow">第二步</p><h1>选择第一个 AI 工具</h1><p class="lead">先打通一个平台，其他工具可在设置中继续添加。</p><div class="tool-list" role="radiogroup" aria-label="AI 工具"><label class="tool-option selected"><input type="radio" name="tool" value="chatgpt-web" checked><span><b>ChatGPT 网页版</b><small>通过 Chrome 扩展连接，推荐优先使用</small></span></label><label class="tool-option disabled"><input type="radio" name="tool" disabled><span><b>Claude Code</b><small>稍后添加</small></span></label><label class="tool-option disabled"><input type="radio" name="tool" disabled><span><b>WorkBuddy</b><small>等待官方接口验证</small></span></label></div><div class="setup-actions horizontal"><button id="tool-back" class="secondary">返回</button><button id="tool-next" class="primary">连接 ChatGPT 网页版</button></div></div>`;
  }
  if (onboardingStep === 3) {
    const connected = extensionState === "connected";
    return `<div class="setup-copy"><p class="eyebrow">第三步</p><h1>安装 Chrome 扩展</h1><p class="lead">Chrome 要求你亲自确认安装权限。安装完成后，扩展会自动连接桌面应用。</p><div class="connection-status ${extensionState}" aria-live="polite"><b>${connected ? "Chrome 扩展已连接" : extensionState === "checking" ? "正在检测扩展连接…" : "等待安装 Chrome 扩展"}</b><span>${connected ? "桌面端和扩展已完成握手。" : extensionMessage}</span></div><div class="trust-note"><b>读取范围</b><span>只有你在 ChatGPT 中主动开启的对话才会被读取。</span></div><div class="setup-actions">${connected ? '<button id="extension-next" class="primary">继续</button>' : '<button id="open-extension" class="primary">打开 Chrome 应用商店</button><button id="detect-extension" class="secondary">我已安装，重新检测</button>'}<button id="extension-back" class="text-action">返回上一步</button></div></div>`;
  }
  return `<div class="setup-complete"><p class="success-mark">连接成功</p><h1>ChatGPT 网页版已连接</h1><p class="lead">知识沉淀已经准备好，接下来只需要在一个 ChatGPT 对话中主动开启。</p><div class="connected-row"><span><b>Chrome 扩展</b><small>已连接</small></span><span><b>桌面应用</b><small>${paired ? "设备已配对" : "前端引导已完成"}</small></span></div><ol class="next-steps"><li>打开任意 ChatGPT 对话</li><li>点击页面右侧悬浮的“知”图标</li><li>确认“从现在开始沉淀”</li></ol><div class="trust-note"><b>你始终可控</b><span>开启前不会读取对话；每个会话都可单独暂停或关闭。</span></div><div class="setup-actions"><button id="open-chatgpt" class="primary">打开 ChatGPT 开启第一次知识沉淀</button><button id="finish-later" class="secondary">稍后再说</button><button id="add-tool" class="text-action">以后添加其他 AI 工具</button></div></div>`;
}

function cockpitView(): string {
  return `<div class="sessionbar"><div class="session-summary"><span class="capture-state ${wakeState}"><i></i>${escapeHtml(wakeMessage)}</span><span class="session-label">${sessionId ? `会话 ${escapeHtml(sessionId)}` : "尚未选择知识会话"}</span></div><div><button id="reload">刷新</button><button id="open-web-panel">完整面板</button><button id="settings">会话</button></div></div><section id="settings-sheet" class="settings-sheet" hidden><label for="session-id">打开指定会话</label><div class="settings-row"><input id="session-id" value="${escapeAttribute(sessionId)}" placeholder="session_xxx"><button id="save-session">打开</button></div><p>服务器：${escapeHtml(origin)}</p><hr><label for="device-token">桌面设备配对</label><p>${paired ? "已安全保存到 Windows 凭据管理器。" : "将账号安全页的一次性设备令牌粘贴到这里。"}</p><div class="settings-row"><input id="device-token" type="password" autocomplete="off" placeholder="kc_device_…"><button id="save-device">${paired ? "替换" : "配对"}</button>${paired ? '<button id="clear-device" class="secondary">解除</button>' : ""}</div><button id="restart-onboarding" class="secondary guide-reset">重新查看首次使用引导</button></section>${cockpitContentView()}`;
}

function cockpitContentView(): string {
  if (!sessionId) return `<section class="cockpit-content"><div class="cockpit-state"><b>等待 ChatGPT 对话</b><span>在 ChatGPT 页面点击“知”，并确认“从现在开始沉淀”。</span></div></section>`;
  if (cockpitLoading && !cockpitData) return `<section class="cockpit-content"><div class="cockpit-state loading-state"><i></i><b>正在读取当前知识会话…</b></div></section>`;
  if (cockpitError && !cockpitData) return `<section class="cockpit-content"><div class="cockpit-state error-state"><b>暂时无法读取</b><span>${escapeHtml(cockpitError)}</span><button id="retry-session">重试</button></div></section>`;
  if (!cockpitData) return `<section class="cockpit-content"><div class="cockpit-state"><b>知识会话已连接</b><span>首轮知识卡片生成后会显示在这里。</span></div></section>`;
  const activeCards = cockpitData.cards.filter(card => card.lifecycle === "active");
  return `<section class="cockpit-content"><header class="cockpit-head"><div><p>知识驾驶舱 · CURSOR ${cockpitData.cursor}</p><h1>${escapeHtml(cockpitData.session.title || "未命名会话")}</h1></div><span class="session-status ${cockpitData.session.status}">${sessionStatusLabel(cockpitData.session.status)}</span></header>${cockpitError ? `<p class="sync-warning">后台刷新失败：${escapeHtml(cockpitError)}</p>` : ""}<div class="cockpit-metrics"><span><b>${activeCards.length}</b> 条有效知识</span><span><b>${cockpitData.learning_debts.length}</b> 个待深挖</span></div><div class="card-list">${activeCards.map(cardView).join("") || '<div class="cockpit-state compact-state"><b>等待第一张知识卡片</b><span>你继续对话后，新的知识点会自动出现在这里。</span></div>'}</div></section>`;
}

function cardView(card: DesktopCard): string {
  return `<article class="knowledge-card"><div><span>${escapeHtml(cardTypeLabel(card.type))}</span><small>v${card.revision}</small></div><h2>${escapeHtml(card.title)}</h2><p>${escapeHtml(card.summary)}</p></article>`;
}

function cardTypeLabel(type: string): string {
  return ({ principle: "原理", framework: "框架", method: "方法", operation: "操作", correction: "纠偏", learning_debt: "待深挖" } as Record<string, string>)[type] ?? "知识";
}

function sessionStatusLabel(status: DesktopSessionState["session"]["status"]): string {
  return status === "active" ? "沉淀中" : status === "paused" ? "已暂停" : "已结束";
}

function escapeHtml(value: string): string {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

function escapeAttribute(value: string): string { return escapeHtml(value).replace(/"/g, "&quot;"); }
function openExternal(url: string): void { window.open(url, "_blank", "noopener,noreferrer"); }

async function native(action: (target: ReturnType<typeof getCurrentWindow>) => Promise<unknown>): Promise<void> {
  if (!nativeWindow) return;
  try { await action(nativeWindow); } catch (error) { console.error(error); }
}

function bindCommon(): void {
  document.querySelector("#pin")?.addEventListener("click", () => void native(async target => { pinned = !pinned; await target.setAlwaysOnTop(pinned); localStorage.setItem("kc-desktop-pinned", String(pinned)); render(); }));
  document.querySelector("#minimize")?.addEventListener("click", () => void native(target => target.minimize()));
  document.querySelector("#close")?.addEventListener("click", () => void native(target => target.close()));
  document.querySelector("#compact")?.addEventListener("click", () => void setCompact(true));
  document.querySelector("#restore")?.addEventListener("click", () => void setCompact(false));
}

function bindOnboarding(): void {
  document.querySelector("#open-login")?.addEventListener("click", () => void beginLogin());
  document.querySelector("#login-next")?.addEventListener("click", () => setOnboardingStep(2));
  document.querySelector("#tool-back")?.addEventListener("click", () => setOnboardingStep(1));
  document.querySelector("#tool-next")?.addEventListener("click", () => setOnboardingStep(3));
  document.querySelector("#extension-back")?.addEventListener("click", () => setOnboardingStep(2));
  document.querySelector("#open-extension")?.addEventListener("click", () => void openExtensionStore());
  document.querySelector("#detect-extension")?.addEventListener("click", () => void detectExtension());
  document.querySelector("#extension-next")?.addEventListener("click", () => setOnboardingStep(4));
  document.querySelector("#open-chatgpt")?.addEventListener("click", () => { finishOnboarding(); openExternal(CHATGPT_URL); });
  document.querySelector("#finish-later")?.addEventListener("click", finishOnboarding);
  document.querySelector("#add-tool")?.addEventListener("click", () => setOnboardingStep(2));
}

async function beginLogin(): Promise<void> {
  if (!hasTauri) {
    loginState = "error";
    loginMessage = "浏览器预览无法接收系统登录回调，请在桌面应用中登录。";
    render();
    return;
  }
  loginState = "opening";
  loginMessage = "正在生成安全登录请求…";
  render();
  try {
    await invoke<string>("begin_oauth_login");
    loginState = "waiting";
    loginMessage = "请在系统浏览器中完成登录。";
  } catch (error) {
    loginState = "error";
    loginMessage = String(error);
  }
  render();
}

async function openExtensionStore(): Promise<void> {
  extensionState = "checking";
  extensionMessage = "安装完成后扩展会自动连接。";
  render();
  let storeUrl = CHROME_STORE_URL;
  if (hasTauri) {
    try {
      const registration = await invoke<NativeHostRegistration>("native_host_registration_status");
      storeUrl = registration.store_url;
      if (!registration.configured) extensionMessage = `${registration.message}；可先加载开发版扩展。`;
    } catch (error) {
      extensionMessage = `Native Messaging 注册失败：${String(error)}`;
    }
  }
  openExternal(storeUrl);
  render();
}

async function detectExtension(): Promise<void> {
  extensionState = "checking";
  extensionMessage = "正在询问本机 Native Messaging 连接状态…";
  render();
  if (!hasTauri) {
    extensionState = "idle";
    extensionMessage = "浏览器预览无法检测扩展，请在桌面应用中完成此步骤。";
    render();
    return;
  }
  try {
    const connection = await invoke<ExtensionConnection>("extension_connection_status");
    extensionState = connection.connected ? "connected" : connection.status === "stale" ? "stale" : "idle";
    extensionMessage = connection.connected
      ? `${connection.browser ?? "Chrome"} 扩展 ${connection.version ?? ""} 已完成实时握手。`
      : connection.status === "stale" ? "扩展连接已经失效，请确认 Chrome 和扩展均已启用。" : "尚未收到扩展连接，请确认扩展已启用后重试。";
  } catch (error) {
    extensionState = "idle";
    extensionMessage = `检测失败：${String(error)}`;
  }
  render();
}

function finishOnboarding(): void {
  onboardingComplete = true;
  onboardingStep = 4;
  localStorage.setItem(ONBOARDING_COMPLETE_KEY, "true");
  localStorage.setItem(ONBOARDING_STEP_KEY, "4");
  render();
  if (sessionId) void loadCockpit();
}

function bindCockpit(): void {
  document.querySelector("#reload")?.addEventListener("click", () => void loadCockpit(true));
  document.querySelector("#retry-session")?.addEventListener("click", () => void loadCockpit(true));
  document.querySelector("#open-web-panel")?.addEventListener("click", () => openExternal(webPanelUrl()));
  document.querySelector("#settings")?.addEventListener("click", () => { const sheet = document.querySelector<HTMLElement>("#settings-sheet")!; sheet.hidden = !sheet.hidden; });
  document.querySelector("#save-session")?.addEventListener("click", () => {
    sessionId = document.querySelector<HTMLInputElement>("#session-id")!.value.trim();
    cockpitData = null; cockpitError = "";
    if (sessionId) localStorage.setItem("kc-desktop-session", sessionId); else localStorage.removeItem("kc-desktop-session");
    render();
    if (sessionId) void loadCockpit(true);
  });
  document.querySelector("#save-device")?.addEventListener("click", () => void saveDevice());
  document.querySelector("#clear-device")?.addEventListener("click", () => void clearDevice());
  document.querySelector("#restart-onboarding")?.addEventListener("click", () => { onboardingComplete = false; onboardingStep = 1; extensionState = "idle"; loginState = paired ? "authenticated" : "idle"; loginMessage = paired ? "这台设备已经完成账号登录和安全配对。" : "登录不会自动读取任何 AI 对话。"; localStorage.removeItem(ONBOARDING_COMPLETE_KEY); localStorage.setItem(ONBOARDING_STEP_KEY, "1"); render(); });
}

async function loadCockpit(showLoading = false): Promise<void> {
  if (!hasTauri || !paired || !sessionId || cockpitLoading) return;
  cockpitLoading = true;
  cockpitError = "";
  if (showLoading || !cockpitData) render();
  try {
    cockpitData = await invoke<DesktopSessionState>("get_desktop_session", { sessionId });
  } catch (error) {
    cockpitError = String(error);
  } finally {
    cockpitLoading = false;
    if (!shouldShowOnboarding()) render();
  }
}

async function saveDevice(): Promise<void> {
  const token = document.querySelector<HTMLInputElement>("#device-token")!.value.trim();
  if (!hasTauri) { wakeState = "error"; wakeMessage = "请在桌面应用中配对"; render(); return; }
  try { await invoke("save_device_credential", { deviceToken: token }); paired = true; wakeState = "idle"; wakeMessage = "设备已配对 · 采集关闭"; render(); if (sessionId) void loadCockpit(true); }
  catch (error) { wakeState = "error"; wakeMessage = String(error); render(); }
}

async function clearDevice(): Promise<void> {
  if (!hasTauri) return;
  try { await invoke("clear_device_credential"); paired = false; cockpitData = null; cockpitError = ""; wakeState = "idle"; wakeMessage = "设备未配对 · 采集关闭"; render(); }
  catch (error) { wakeState = "error"; wakeMessage = String(error); render(); }
}

async function handleDeepLink(raw: string): Promise<void> {
  let url: URL;
  try { url = new URL(raw); } catch { return; }
  if (url.protocol !== "knowledge-copilot:") return;
  if (url.hostname === "auth" && url.pathname === "/callback") {
    await native(async target => { await target.show(); await target.unminimize(); await target.setFocus(); });
    loginState = "opening"; loginMessage = "正在验证登录并配对这台设备…"; render();
    try {
      const result = await invoke<{ paired: boolean; device_name: string }>("complete_oauth_login", { callbackUrl: raw });
      paired = result.paired;
      loginState = "authenticated";
      loginMessage = `${result.device_name} 已安全配对，设备凭证已保存到 Windows 凭据管理器。`;
    } catch (error) {
      loginState = "error"; loginMessage = String(error);
    }
    render(); return;
  }
  if (url.hostname === "conversation") {
    const nextSession = url.searchParams.get("session") ?? "";
    const source = url.searchParams.get("source") ?? "ChatGPT";
    if (!/^session_[A-Za-z0-9-]{16,80}$/.test(nextSession)) { wakeState = "error"; wakeMessage = "会话唤醒链接无效"; render(); return; }
    sessionId = nextSession;
    localStorage.setItem("kc-desktop-session", sessionId);
    onboardingComplete = true;
    localStorage.setItem(ONBOARDING_COMPLETE_KEY, "true");
    if (compact) await setCompact(false);
    await native(async target => { await target.show(); await target.unminimize(); await target.setFocus(); });
    cockpitData = null; cockpitError = "";
    wakeState = "ready"; wakeMessage = `${source} 对话已连接`; render(); void loadCockpit(true); return;
  }
  if (url.hostname === "collapse") {
    wakeState = "idle"; wakeMessage = "当前页面未启用知识沉淀";
    if (!pinned) await setCompact(true); else render();
    return;
  }
  if (url.hostname === "open") { await native(async target => { await target.show(); await target.unminimize(); await target.setFocus(); }); wakeState = "idle"; wakeMessage = paired ? "设备已配对 · 采集关闭" : "设备未配对 · 采集关闭"; render(); return; }
  if (url.hostname !== "wake") return;
  const token = url.searchParams.get("token") ?? "";
  if (!/^kc_wake_[A-Za-z0-9_-]{32,152}$/.test(token)) { wakeState = "error"; wakeMessage = "唤醒链接格式无效"; render(); return; }
  await native(async target => { await target.show(); await target.unminimize(); await target.setFocus(); });
  wakeState = "opening"; wakeMessage = "正在验证一次性唤醒请求…"; render();
  try {
    const intent = await invoke<{ session_id: string | null; source_host: string }>("consume_wake_token", { wakeToken: token });
    if (intent.session_id) { sessionId = intent.session_id; localStorage.setItem("kc-desktop-session", sessionId); }
    onboardingComplete = true; localStorage.setItem(ONBOARDING_COMPLETE_KEY, "true");
    cockpitData = null; cockpitError = "";
    wakeState = "ready"; wakeMessage = `${intent.source_host} 已唤醒 · 等待采集授权`; render(); void loadCockpit(true);
  } catch (error) { wakeState = "error"; wakeMessage = String(error); render(); }
}

async function initializeNative(): Promise<void> {
  if (!hasTauri) return;
  try {
    paired = await invoke<boolean>("device_is_paired");
    if (paired) { loginState = "authenticated"; loginMessage = "这台设备已经完成账号登录和安全配对。"; }
    wakeMessage = paired ? "设备已配对 · 采集关闭" : "设备未配对 · 采集关闭";
    await invoke<NativeHostRegistration>("native_host_registration_status").catch(() => undefined);
    render();
    if (sessionId && !shouldShowOnboarding()) void loadCockpit();
  } catch { paired = false; }
  await onOpenUrl(urls => { for (const url of urls) void handleDeepLink(url); });
  for (const url of await getCurrent() ?? []) await handleDeepLink(url);
}

async function setCompact(next: boolean): Promise<void> {
  if (next === compact) return;
  if (nativeWindow) {
    if (next) { previousSize = await nativeWindow.innerSize(); await nativeWindow.setSize(new LogicalSize(86, 86)); }
    else { const scale = await nativeWindow.scaleFactor(); await nativeWindow.setSize(previousSize ? previousSize.toLogical(scale) : new LogicalSize(420, 720)); }
  }
  compact = next; render();
}

window.addEventListener("online", render);
window.addEventListener("offline", render);
window.setInterval(() => {
  if (navigator.onLine && !compact && !shouldShowOnboarding() && sessionId) void loadCockpit(false);
}, 8_000);
render();
void initializeNative();
