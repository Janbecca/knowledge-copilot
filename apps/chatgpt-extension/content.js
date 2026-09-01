const INVOCATION = /(?:@\s*knowledge\s*copilot|@\s*知识(?:副驾驶|驾驶舱)|开启知识沉淀|打开知识驾驶舱)/i;
const GRANT_PREFIX = "kc-grant:";
let conversationRef = currentConversation();
let grant = null;
let launcher = null;
let expanded = false;
let lastCandidate = "";
let stableScans = 0;
let scanTimer = 0;

function currentConversation() {
  const match = location.pathname.match(/^\/c\/([^/?#]+)/);
  return match ? `chatgpt:${match[1]}` : null;
}

function conversationTitle() {
  return document.title.replace(/\s*[|·-]\s*ChatGPT\s*$/i, "").trim().slice(0, 80) || "ChatGPT 对话";
}

function grantKey() { return conversationRef ? `${GRANT_PREFIX}${conversationRef}` : null; }
function send(payload) { return chrome.runtime.sendMessage({ channel: "knowledge-copilot", payload }); }

async function digest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function loadGrant() {
  const key = grantKey();
  const cached = key ? (await chrome.storage.local.get(key))[key] ?? null : null;
  grant = cached;
  if (conversationRef) {
    try {
      const response = await send({ version: 1, type: "get_binding", source_host: "chatgpt", conversation_ref: conversationRef });
      if (response?.ok && response.binding) {
        grant = { ...(cached ?? {}), status: response.binding.capture_status, source_host: "chatgpt", conversation_ref: conversationRef, binding_id: response.binding.binding_id, session_id: response.binding.session_id, updated_at: response.binding.updated_at };
        if (key) await chrome.storage.local.set({ [key]: grant });
      }
    } catch { /* cached status remains available while desktop is offline */ }
  }
  renderLauncher();
  if (grant) void reportPresence(document.visibilityState === "visible" ? "foreground" : "background");
}

async function persistGrant(status, syncServer = true) {
  const key = grantKey(); if (!key) return false;
  if (syncServer) {
    const response = await send({ version: 1, type: "set_binding_status", source_host: "chatgpt", conversation_ref: conversationRef, capture_status: status });
    if (!response?.ok) { renderLauncher(response?.error ?? "桌面代理未连接"); return false; }
  }
  grant = { ...(grant ?? {}), status, source_host: "chatgpt", conversation_ref: conversationRef, updated_at: new Date().toISOString() };
  await chrome.storage.local.set({ [key]: grant }); renderLauncher(); return true;
}

function renderLauncher(message = "") {
  launcher?.remove(); launcher = null;
  if (!conversationRef) return;
  if (message) expanded = true;
  const root = document.createElement("div"); root.id = "knowledge-copilot-launcher";
  const shadow = root.attachShadow({ mode: "closed" });
  const status = grant?.status ?? "off";
  const active = status === "active"; const paused = status === "paused"; const ended = status === "ended";
  const statusLabel = active ? "正在沉淀" : paused ? "已暂停" : ended ? "已结束" : "未开启";
  shadow.innerHTML = `<style>
    :host{all:initial}.dock{position:fixed;z-index:2147483647;right:18px;top:50%;transform:translateY(-50%);display:flex;align-items:flex-start;gap:9px;font:12px/1.45 system-ui,"Microsoft YaHei",sans-serif}.orb{width:46px;height:46px;border:1px solid #b8d4c3;border-radius:50%;background:${active ? "#176b49" : paused ? "#a96f15" : "#f3f8f5"};color:${active || paused ? "white" : "#176b49"};box-shadow:0 8px 28px #10281d35;cursor:pointer;font:700 22px system-ui;display:grid;place-items:center}.orb:focus-visible,button:focus-visible{outline:3px solid #75b991;outline-offset:2px}.panel{width:238px;padding:13px;border:1px solid #bfd0c5;border-radius:15px;background:#f9fcfa;color:#173b2b;box-shadow:0 12px 38px #172b2038}.panel[hidden]{display:none}.row{display:flex;align-items:center;gap:8px}.dot{width:8px;height:8px;border-radius:50%;background:${active ? "#258456" : paused ? "#d39a2f" : "#87958d"}.title{font-weight:700;flex:1}.status{color:#63776b;font-size:11px}.msg{margin:9px 0 0;color:#8b5d17;font-size:11px}.hint{margin:8px 0 0;color:#65756c;font-size:11px}.buttons{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}button.action{border:0;border-radius:8px;padding:6px 9px;background:#e3ede7;color:#254f3a;cursor:pointer;font:11px system-ui}button.primary{background:#256b49;color:white}</style><div class="dock"><section class="panel" ${expanded || message ? "" : "hidden"} aria-label="Knowledge Copilot 当前对话驾驶舱"><div class="row"><i class="dot"></i><span class="title">当前 ChatGPT 对话</span><span class="status">${statusLabel}</span></div>${message ? '<p class="msg"></p>' : ""}<p class="hint">${active ? "仅持续整理从授权时刻之后完成的轮次。" : ended ? "历史知识仍然保留，可重新开启当前对话。" : "开启前不会读取当前对话正文。"}</p><div class="buttons">${active ? '<button class="action primary" data-action="open">打开驾驶舱</button><button class="action" data-action="pause">暂停</button><button class="action" data-action="stop">结束</button>' : paused ? '<button class="action primary" data-action="resume">恢复</button><button class="action" data-action="open">查看历史</button><button class="action" data-action="stop">结束</button>' : `<button class="action primary" data-action="grant">${ended ? "重新开启" : "从现在开始沉淀"}</button>${ended ? '<button class="action" data-action="open">查看历史</button>' : ""}`}</div></section><button class="orb" aria-label="${expanded ? "收起" : "打开"} Knowledge Copilot 当前对话驾驶舱" aria-expanded="${expanded}">知</button></div>`;
  if (message) shadow.querySelector(".msg").textContent = message;
  shadow.querySelector(".orb").addEventListener("click", () => { expanded = !expanded; renderLauncher(); });
  shadow.querySelectorAll("button.action").forEach(button => button.addEventListener("click", () => void action(button.dataset.action)));
  document.documentElement.append(root); launcher = root;
}

async function action(name) {
  if (name === "grant") {
    const accepted = confirm("从现在开始，允许 Knowledge Copilot 读取并整理当前 ChatGPT 对话中后续完成的文字轮次。不会读取其他对话、输入框、剪贴板、键盘或屏幕。是否继续？");
    if (!accepted) return;
    const response = await send({ version: 1, type: "grant_consent", source_host: "chatgpt", conversation_ref: conversationRef, scope: "conversation-text", title: conversationTitle() });
    if (!response?.ok) { expanded = true; renderLauncher(response?.error ?? "桌面代理未连接；请先安装并登录桌面端"); return; }
    grant = { status: "active", source_host: "chatgpt", conversation_ref: conversationRef, binding_id: response.binding?.binding_id, session_id: response.binding?.session_id, updated_at: new Date().toISOString() };
    const key = grantKey(); if (key) await chrome.storage.local.set({ [key]: grant });
    await markCurrentTurnSeen();
    expanded = true; renderLauncher("已开启：只会整理从现在开始完成的轮次。");
    await send({ version: 1, type: "wake", source_host: "chatgpt", conversation_ref: conversationRef });
    void reportPresence("foreground"); scheduleScan(); return;
  }
  if (name === "open") { await send({ version: 1, type: "wake", source_host: "chatgpt", conversation_ref: conversationRef }); return; }
  if (name === "pause") await persistGrant("paused");
  if (name === "resume") { if (await persistGrant("active")) { void reportPresence("foreground"); scheduleScan(); } }
  if (name === "stop") {
    if (!confirm("结束后将停止整理新内容，但已经生成的知识记录会继续保留。确定结束当前对话的知识沉淀吗？")) return;
    if (!(await persistGrant("ended"))) return;
    await send({ version: 1, type: "revoke_consent", source_host: "chatgpt", conversation_ref: conversationRef }).catch(() => undefined);
    expanded = true; renderLauncher("已结束采集，历史知识记录仍然保留。");
  }
}

async function reportPresence(status) {
  if (!conversationRef || !grant?.binding_id) return;
  await send({ version: 1, type: "presence", source_host: "chatgpt", conversation_ref: conversationRef, presence_status: status }).catch(() => undefined);
}

function turns() {
  return [...document.querySelectorAll("[data-message-author-role]")].map(element => ({ role: element.getAttribute("data-message-author-role"), text: (element.innerText || "").trim() }))
    .filter(item => (item.role === "user" || item.role === "assistant") && item.text && !item.text.includes("Knowledge Copilot ·"));
}

async function markCurrentTurnSeen() {
  const items = turns(); const assistant = items.at(-1); const user = items.slice(0, -1).findLast(item => item.role === "user");
  if (!user || assistant?.role !== "assistant") return;
  const candidate = `${user.text}\n---assistant---\n${assistant.text}`;
  const idempotencyKey = `chatgpt:${await digest(`${conversationRef}:${candidate}`)}`;
  await chrome.storage.local.set({ [`kc-seen:${idempotencyKey}`]: Date.now() });
  lastCandidate = candidate;
}

async function scan() {
  scanTimer = 0;
  const nextConversation = currentConversation();
  if (nextConversation !== conversationRef) {
    if (grant?.binding_id) await reportPresence("background");
    conversationRef = nextConversation; grant = null; lastCandidate = ""; stableScans = 0; expanded = false; await loadGrant();
  }
  if (!grant) {
    const latestUser = [...document.querySelectorAll('[data-message-author-role="user"]')].at(-1);
    const invocationText = (latestUser?.innerText || "").trim();
    if (INVOCATION.test(invocationText)) { expanded = true; renderLauncher("检测到调用词。确认后才会读取当前对话。"); }
    return;
  }
  if (grant.status !== "active") return;
  const items = turns(); const assistant = items.at(-1); const user = items.slice(0, -1).findLast(item => item.role === "user");
  if (!user || assistant?.role !== "assistant") return;
  const candidate = `${user.text}\n---assistant---\n${assistant.text}`;
  if (candidate !== lastCandidate) { lastCandidate = candidate; stableScans = 0; setTimeout(scheduleScan, 1400); return; }
  stableScans += 1; if (stableScans < 1) return;
  const idempotencyKey = `chatgpt:${await digest(`${conversationRef}:${candidate}`)}`;
  const seenKey = `kc-seen:${idempotencyKey}`;
  if ((await chrome.storage.local.get(seenKey))[seenKey]) return;
  const response = await send({ version: 1, type: "capture_turn", source_host: "chatgpt", conversation_ref: conversationRef, user_message: user.text, assistant_message: assistant.text, idempotency_key: idempotencyKey });
  if (response?.ok) { await chrome.storage.local.set({ [seenKey]: Date.now() }); renderLauncher(response.queued ? "桌面端暂时离线，本轮已安全排队并将在恢复后补交。" : "上一轮已安全提交"); }
  else { expanded = true; renderLauncher(response?.error ?? "提交失败；内容未标记为已发送"); }
}

function scheduleScan() { clearTimeout(scanTimer); scanTimer = setTimeout(() => void scan(), 500); }
new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
document.addEventListener("visibilitychange", () => void reportPresence(document.visibilityState === "visible" ? "foreground" : "background"));
window.addEventListener("pagehide", () => void reportPresence("closed"));
chrome.runtime.onMessage.addListener(message => { if (message?.channel === "knowledge-copilot-ui") { expanded = !expanded; renderLauncher(); } });
void loadGrant().then(scheduleScan);
