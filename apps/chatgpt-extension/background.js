const NATIVE_HOST = "xyz.knowledge_copilot.desktop";
const INSTALL_URL = "https://knowledge-copilot.xyz/install/";
const HEARTBEAT_ALARM = "knowledge-copilot-native-heartbeat";
const RETRY_ALARM = "knowledge-copilot-capture-retry";
const QUEUE_KEY = "kc-native-capture-queue";
const MAX_QUEUE_ITEMS = 100;
let flushPromise = null;
let queueLock = Promise.resolve();

function withQueueLock(action) {
  const result = queueLock.then(action, action);
  queueLock = result.then(() => undefined, () => undefined);
  return result;
}

function sendNative(payload) {
  return new Promise(resolve => {
    chrome.runtime.sendNativeMessage(NATIVE_HOST, payload, response => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message, install_url: INSTALL_URL });
        return;
      }
      resolve(response ?? { ok: false, error: "桌面代理没有返回结果" });
    });
  });
}

function announceConnection() {
  chrome.runtime.sendNativeMessage(NATIVE_HOST, {
    type: "extension_hello", source_host: "chatgpt",
    version: chrome.runtime.getManifest().version, browser: "chrome",
  }, () => void chrome.runtime.lastError);
}

async function readQueue() {
  return (await chrome.storage.local.get(QUEUE_KEY))[QUEUE_KEY] ?? [];
}

async function writeQueue(items) {
  await chrome.storage.local.set({ [QUEUE_KEY]: items });
}

async function enqueueCapture(payload, error) {
  return withQueueLock(async () => {
    const queue = await readQueue();
    const existing = queue.find(item => item.payload.idempotency_key === payload.idempotency_key);
    if (existing) {
      existing.error = error; existing.next_attempt_at = Date.now() + 5_000;
    } else {
      if (queue.length >= MAX_QUEUE_ITEMS) return false;
      queue.push({ payload, attempts: 0, queued_at: Date.now(), next_attempt_at: Date.now() + 5_000, error });
    }
    await writeQueue(queue);
    return true;
  });
}

async function discardConversationQueue(payload) {
  await withQueueLock(async () => {
    const queue = await readQueue();
    await writeQueue(queue.filter(item => !(item.payload.source_host === payload.source_host && item.payload.conversation_ref === payload.conversation_ref)));
  });
}

async function flushCaptureQueue() {
  if (flushPromise) return flushPromise;
  flushPromise = withQueueLock(async () => {
    const queue = await readQueue(); const remaining = [];
    for (const item of queue) {
      if (item.next_attempt_at > Date.now()) { remaining.push(item); continue; }
      const response = await sendNative(item.payload);
      if (!response?.ok) {
        const attempts = item.attempts + 1;
        remaining.push({ ...item, attempts, error: response?.error ?? "retry failed", next_attempt_at: Date.now() + Math.min(300_000, 5_000 * (2 ** Math.min(attempts, 6))) });
      }
    }
    await writeQueue(remaining);
  }).finally(() => { flushPromise = null; });
  return flushPromise;
}

async function forwardMessage(payload) {
  const response = await sendNative(payload);
  if (payload?.type === "revoke_consent") { await discardConversationQueue(payload); return response; }
  if (payload?.type !== "capture_turn" || response?.ok) {
    if (response?.ok) void flushCaptureQueue();
    return response;
  }
  if (!(await enqueueCapture(payload, response?.error ?? "desktop unavailable"))) return { ok: false, error: "本地重试队列已满，请保持当前页面并恢复桌面端连接" };
  return { ok: true, queued: true, message: "桌面端暂时不可用，本轮已进入本地重试队列" };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 2 });
  chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });
  announceConnection(); void flushCaptureQueue();
});
chrome.runtime.onStartup.addListener(() => { announceConnection(); void flushCaptureQueue(); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === HEARTBEAT_ALARM) announceConnection();
  if (alarm.name === RETRY_ALARM) void flushCaptureQueue();
});
chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 2 });
chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 1 });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.channel !== "knowledge-copilot") return false;
  void forwardMessage(message.payload).then(sendResponse);
  return true;
});

chrome.action.onClicked.addListener(tab => {
  if (tab.id) chrome.tabs.sendMessage(tab.id, { channel: "knowledge-copilot-ui", type: "toggle" });
});

announceConnection();
