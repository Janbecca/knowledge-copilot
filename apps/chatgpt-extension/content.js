const INVOCATION = /(?:@\s*knowledge\s*copilot|@\s*知识(?:副驾驶|驾驶舱)|开启知识沉淀|打开知识驾驶舱)/i;
const GRANT_PREFIX = "kc-grant:";
let conversationRef = currentConversation();
let grant = null;
let badge = null;
let lastCandidate = "";
let stableScans = 0;
let scanTimer = 0;

function currentConversation() {
  const match = location.pathname.match(/^\/c\/([^/?#]+)/);
  return match ? `chatgpt:${match[1]}` : null;
}

function grantKey() { return conversationRef ? `${GRANT_PREFIX}${conversationRef}` : null; }
function send(payload) { return chrome.runtime.sendMessage({ channel: "knowledge-copilot", payload }); }

async function digest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function loadGrant() {
  const key = grantKey();
  grant = key ? (await chrome.storage.local.get(key))[key] ?? null : null;
  renderBadge();
}

async function saveGrant(status) {
  const key = grantKey(); if (!key) return;
  grant = { status, source_host: "chatgpt", conversation_ref: conversationRef, updated_at: new Date().toISOString() };
  await chrome.storage.local.set({ [key]: grant }); renderBadge();
}

function renderBadge(message = "") {
  badge?.remove(); badge = null;
  if (!conversationRef) return;
  const root = document.createElement("div"); root.id = "knowledge-copilot-capture-indicator";
  const shadow = root.attachShadow({ mode: "closed" });
  const status = grant?.status ?? "off";
  shadow.innerHTML = `<style>:host{all:initial}.box{position:fixed;z-index:2147483647;right:18px;top:70px;width:210px;padding:10px 12px;border:1px solid #bfd0c5;border-radius:13px;background:#f7faf8;color:#173b2b;box-shadow:0 10px 34px #172b2030;font:12px/1.4 system-ui,sans-serif}.row{display:flex;align-items:center;gap:7px}.dot{width:8px;height:8px;border-radius:50%;background:${status === "active" ? "#258456" : status === "paused" ? "#d39a2f" : "#87958d"}.title{font-weight:700;flex:1}.msg{margin:6px 0;color:#65756c;font-size:11px}.buttons{display:flex;gap:6px;margin-top:7px}button{border:0;border-radius:7px;padding:5px 8px;background:#e3ede7;color:#254f3a;cursor:pointer;font:11px system-ui}button.primary{background:#256b49;color:white}</style><div class="box"><div class="row"><i class="dot"></i><span class="title">知识驾驶舱 · ${status === "active" ? "正在采集" : status === "paused" ? "已暂停" : "未授权"}</span></div>${message ? `<p class="msg"></p>` : ""}<div class="buttons">${status === "active" ? '<button data-action="pause">暂停</button><button data-action="stop">停止并撤销</button>' : status === "paused" ? '<button class="primary" data-action="resume">恢复</button><button data-action="stop">撤销</button>' : '<button class="primary" data-action="grant">授权当前对话</button>'}</div></div>`;
  if (message) shadow.querySelector(".msg").textContent = message;
  shadow.querySelectorAll("button").forEach(button => button.addEventListener("click", () => void action(button.dataset.action)));
  document.documentElement.append(root); badge = root;
}

async function action(name) {
  if (name === "grant") {
    const accepted = confirm("仅授权 Knowledge Copilot 读取当前 ChatGPT 对话的文字轮次。不会读取其他标签页、密码框、剪贴板、键盘或屏幕。你可以随时暂停或撤销。是否继续？");
    if (!accepted) return;
    const response = await send({ version: 1, type: "grant_consent", source_host: "chatgpt", conversation_ref: conversationRef, scope: "conversation-text" });
    if (!response?.ok) { renderBadge(response?.error ?? "桌面代理未连接；请先安装并配对"); return; }
    await saveGrant("active"); await send({ version: 1, type: "wake", source_host: "chatgpt", conversation_ref: conversationRef }); scheduleScan(); return;
  }
  if (name === "pause") await saveGrant("paused");
  if (name === "resume") { await saveGrant("active"); scheduleScan(); }
  if (name === "stop") {
    await send({ version: 1, type: "revoke_consent", source_host: "chatgpt", conversation_ref: conversationRef }).catch(() => undefined);
    const key = grantKey(); if (key) await chrome.storage.local.remove(key); grant = null; renderBadge();
  }
}

function turns() {
  return [...document.querySelectorAll("[data-message-author-role]")].map(element => ({
    role: element.getAttribute("data-message-author-role"),
    text: (element.innerText || "").trim(),
  })).filter(item => (item.role === "user" || item.role === "assistant") && item.text && !item.text.includes("Knowledge Copilot ·"));
}

async function scan() {
  scanTimer = 0;
  const nextConversation = currentConversation();
  if (nextConversation !== conversationRef) { conversationRef = nextConversation; lastCandidate = ""; stableScans = 0; await loadGrant(); }
  if (!grant) {
    const latestUser = [...document.querySelectorAll('[data-message-author-role="user"]')].at(-1);
    const invocationText = (latestUser?.innerText || "").trim();
    if (INVOCATION.test(invocationText)) {
      renderBadge("检测到调用词。确认后才会读取当前对话。");
    }
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
  if (response?.ok) { await chrome.storage.local.set({ [seenKey]: Date.now() }); renderBadge("上一轮已安全提交"); }
  else renderBadge(response?.error ?? "提交失败；内容未标记为已发送");
}

function scheduleScan() { clearTimeout(scanTimer); scanTimer = setTimeout(() => void scan(), 500); }
new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
chrome.runtime.onMessage.addListener(message => { if (message?.channel === "knowledge-copilot-ui") renderBadge(); });
void loadGrant().then(scheduleScan);
