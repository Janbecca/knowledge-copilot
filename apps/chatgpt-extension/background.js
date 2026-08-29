const NATIVE_HOST = "xyz.knowledge_copilot.desktop";
const INSTALL_URL = "https://knowledge-copilot.xyz/install/";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.channel !== "knowledge-copilot") return false;
  chrome.runtime.sendNativeMessage(NATIVE_HOST, message.payload, response => {
    if (chrome.runtime.lastError) {
      if (message.payload?.type === "wake") chrome.tabs.create({ url: INSTALL_URL });
      sendResponse({ ok: false, error: chrome.runtime.lastError.message, install_url: INSTALL_URL });
      return;
    }
    sendResponse(response ?? { ok: false, error: "桌面代理没有返回结果" });
  });
  return true;
});

chrome.action.onClicked.addListener(tab => {
  if (tab.id) chrome.tabs.sendMessage(tab.id, { channel: "knowledge-copilot-ui", type: "toggle" });
});
