import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = "apps/desktop-companion";

describe("desktop companion contract", () => {
  it("ships an always-on-top resizable window with least-privilege controls", async () => {
    const config = JSON.parse(await readFile(`${root}/src-tauri/tauri.conf.json`, "utf8"));
    const window = config.app.windows[0];
    expect(window).toMatchObject({ label: "main", alwaysOnTop: true, decorations: false, resizable: true });
    expect(config.app.security.csp).toContain("frame-src https://knowledge-copilot.xyz");

    const capability = JSON.parse(await readFile(`${root}/src-tauri/capabilities/desktop-window.json`, "utf8"));
    expect(capability.windows).toEqual(["main"]);
    expect(capability.permissions).toContain("core:window:allow-start-dragging");
    expect(capability.permissions).toContain("core:window:allow-set-always-on-top");
    expect(capability.permissions.join("\n")).not.toMatch(/shell|filesystem|http:/i);
  });

  it("loads only the HTTPS production panel in explicit desktop mode", async () => {
    const source = await readFile(`${root}/src/main.ts`, "utf8");
    expect(source).toContain('const DEFAULT_ORIGIN = "https://knowledge-copilot.xyz"');
    expect(source).toContain('url.searchParams.set("desktop", "1")');
    expect(source).toContain("allow-scripts allow-forms allow-same-origin allow-popups");
  });
});
