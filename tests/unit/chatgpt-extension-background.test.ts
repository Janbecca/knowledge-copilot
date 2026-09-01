import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("ChatGPT extension native host fallback", () => {
  it("reports the install URL without opening a tab when native messaging fails", async () => {
    let listener: ((message: unknown, sender: unknown, respond: (response: unknown) => void) => boolean) | undefined;
    const createTab = vi.fn();
    const chrome = {
      runtime: {
        lastError: { message: "Specified native messaging host not found." },
        getManifest: () => ({ version: "0.1.1" }),
        onMessage: { addListener: vi.fn((next) => { listener = next; }) },
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        sendNativeMessage: vi.fn((_host, _payload, callback) => callback(undefined)),
      },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
      tabs: {
        create: createTab,
        sendMessage: vi.fn(),
      },
      action: { onClicked: { addListener: vi.fn() } },
    };
    const source = readFileSync(new URL("../../apps/chatgpt-extension/background.js", import.meta.url), "utf8");
    runInNewContext(source, { chrome });

    const respond = vi.fn();
    expect(listener?.({ channel: "knowledge-copilot", payload: { type: "wake" } }, {}, respond)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(createTab).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({
      ok: false,
      install_url: "https://knowledge-copilot.xyz/install/",
    }));
  });

  it("durably queues an authorized capture when the desktop bridge is temporarily unavailable", async () => {
    let listener: ((message: any, sender: unknown, respond: (response: any) => void) => boolean) | undefined;
    const values: Record<string, unknown> = {};
    const chrome = {
      runtime: {
        lastError: { message: "Native host unavailable" }, getManifest: () => ({ version: "0.1.1" }),
        onMessage: { addListener: vi.fn((next) => { listener = next; }) }, onInstalled: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() },
        sendNativeMessage: vi.fn((_host, _payload, callback) => callback(undefined)),
      },
      storage: { local: { get: vi.fn(async (key) => ({ [key]: values[key] })), set: vi.fn(async (next) => Object.assign(values, next)) } },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } }, tabs: { sendMessage: vi.fn() }, action: { onClicked: { addListener: vi.fn() } },
    };
    const source = readFileSync(new URL("../../apps/chatgpt-extension/background.js", import.meta.url), "utf8");
    runInNewContext(source, { chrome, Promise, Date, setTimeout });

    const respond = vi.fn();
    listener?.({ channel: "knowledge-copilot", payload: { type: "capture_turn", idempotency_key: "turn-1" } }, {}, respond);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ ok: true, queued: true }));
    expect(values["kc-native-capture-queue"]).toEqual([expect.objectContaining({ payload: expect.objectContaining({ idempotency_key: "turn-1" }) })]);
  });

  it("preserves concurrent turns from three offline tabs and flushes each idempotency key once", async () => {
    let listener: ((message: any, sender: unknown, respond: (response: any) => void) => boolean) | undefined;
    let alarmListener: ((alarm: { name: string }) => void) | undefined;
    let online = false;
    const delivered: any[] = [];
    const values: Record<string, any> = {};
    const runtime = {
      get lastError() { return online ? undefined : { message: "Native host unavailable" }; },
      getManifest: () => ({ version: "0.1.1" }),
      onMessage: { addListener: vi.fn((next) => { listener = next; }) },
      onInstalled: { addListener: vi.fn() }, onStartup: { addListener: vi.fn() },
      sendNativeMessage: vi.fn((_host, payload, callback) => {
        if (online && payload.type === "capture_turn") delivered.push(payload);
        callback(online ? { ok: true } : undefined);
      }),
    };
    const chrome = {
      runtime,
      storage: { local: { get: vi.fn(async (key) => ({ [key]: values[key] })), set: vi.fn(async (next) => Object.assign(values, next)) } },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn((next) => { alarmListener = next; }) } },
      tabs: { sendMessage: vi.fn() }, action: { onClicked: { addListener: vi.fn() } },
    };
    const source = readFileSync(new URL("../../apps/chatgpt-extension/background.js", import.meta.url), "utf8");
    runInNewContext(source, { chrome, Promise, Date, setTimeout });

    const send = (payload: any) => new Promise<any>(resolve => listener?.({ channel: "knowledge-copilot", payload }, {}, resolve));
    const turns = Array.from({ length: 30 }, (_, index) => ({
      type: "capture_turn", source_host: "chatgpt", conversation_ref: `chatgpt:conversation-${index % 3}`,
      user_message: `Question ${index}`, assistant_message: `Answer ${index}`, idempotency_key: `turn-${index}`,
    }));
    const queued = await Promise.all([...turns.map(send), send(turns[0])]);
    expect(queued.every(response => response.ok && response.queued)).toBe(true);
    expect(values["kc-native-capture-queue"]).toHaveLength(30);

    for (const item of values["kc-native-capture-queue"]) item.next_attempt_at = 0;
    online = true;
    alarmListener?.({ name: "knowledge-copilot-capture-retry" });
    await vi.waitFor(() => expect(values["kc-native-capture-queue"]).toEqual([]));
    expect(delivered).toHaveLength(30);
    expect(new Set(delivered.map(item => item.idempotency_key)).size).toBe(30);
    expect(new Set(delivered.map(item => item.conversation_ref))).toEqual(new Set([
      "chatgpt:conversation-0", "chatgpt:conversation-1", "chatgpt:conversation-2",
    ]));
  });

  it("announces the installed extension to the desktop native host", () => {
    const sendNativeMessage = vi.fn((_host, _payload, callback) => callback(undefined));
    const chrome = {
      runtime: {
        lastError: undefined,
        getManifest: () => ({ version: "0.1.1" }),
        onMessage: { addListener: vi.fn() },
        onInstalled: { addListener: vi.fn() },
        onStartup: { addListener: vi.fn() },
        sendNativeMessage,
      },
      alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
      tabs: { sendMessage: vi.fn() },
      action: { onClicked: { addListener: vi.fn() } },
    };
    const source = readFileSync(new URL("../../apps/chatgpt-extension/background.js", import.meta.url), "utf8");
    runInNewContext(source, { chrome });

    expect(sendNativeMessage).toHaveBeenCalledWith(
      "xyz.knowledge_copilot.desktop",
      expect.objectContaining({ type: "extension_hello", source_host: "chatgpt", version: "0.1.1", browser: "chrome" }),
      expect.any(Function),
    );
  });

  it("keeps desktop wake behind the explicit conversation grant action", () => {
    const source = readFileSync(new URL("../../apps/chatgpt-extension/content.js", import.meta.url), "utf8");
    const actionStart = source.indexOf("async function action");
    const scanStart = source.indexOf("async function scan");
    const actionSource = source.slice(actionStart, scanStart);
    const scanSource = source.slice(scanStart);

    expect(actionSource).toContain('type: "wake"');
    expect(scanSource).not.toContain('type: "wake"');
    expect(source).toContain("knowledge-copilot-launcher");
    expect(source).toContain('type: "get_binding"');
    expect(source).toContain("markCurrentTurnSeen");
    expect(source).toContain("从现在开始沉淀");
  });
});
