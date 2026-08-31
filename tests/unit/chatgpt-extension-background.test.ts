import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("ChatGPT extension native host fallback", () => {
  it("reports the install URL without opening a tab when native messaging fails", () => {
    let listener: ((message: unknown, sender: unknown, respond: (response: unknown) => void) => boolean) | undefined;
    const createTab = vi.fn();
    const chrome = {
      runtime: {
        lastError: { message: "Specified native messaging host not found." },
        onMessage: { addListener: vi.fn((next) => { listener = next; }) },
        sendNativeMessage: vi.fn((_host, _payload, callback) => callback(undefined)),
      },
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
    expect(createTab).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({
      ok: false,
      install_url: "https://knowledge-copilot.xyz/install/",
    }));
  });

  it("keeps desktop wake behind the explicit conversation grant action", () => {
    const source = readFileSync(new URL("../../apps/chatgpt-extension/content.js", import.meta.url), "utf8");
    const actionStart = source.indexOf("async function action");
    const scanStart = source.indexOf("async function scan");
    const actionSource = source.slice(actionStart, scanStart);
    const scanSource = source.slice(scanStart);

    expect(actionSource).toContain('type: "wake"');
    expect(scanSource).not.toContain('type: "wake"');
  });
});
