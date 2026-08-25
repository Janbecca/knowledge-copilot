import { describe, expect, it } from "vitest";
import { loadConfig } from "../../mcp-server/config.js";

describe("runtime config", () => {
  it("keeps development local and production externally reachable", () => {
    expect(loadConfig({ NODE_ENV: "development" }).host).toBe("127.0.0.1");
    expect(loadConfig({ NODE_ENV: "production" }).host).toBe("0.0.0.0");
  });
  it("normalizes deployment settings", () => {
    const config = loadConfig({
      NODE_ENV: "production", KNOWLEDGE_COPILOT_PORT: "8080", KNOWLEDGE_COPILOT_PUBLIC_BASE_URL: "https://example.test/",
      KNOWLEDGE_COPILOT_CORS_ORIGINS: "https://chatgpt.com, https://example.test/", KNOWLEDGE_COPILOT_BODY_LIMIT_BYTES: "2048",
    });
    expect(config).toMatchObject({ port: 8080, publicBaseUrl: "https://example.test", bodyLimitBytes: 2048 });
    expect(config.corsOrigins).toEqual(["https://chatgpt.com", "https://example.test"]);
  });
  it("rejects invalid numeric and URL settings", () => {
    expect(() => loadConfig({ KNOWLEDGE_COPILOT_PORT: "zero" })).toThrow(/PORT/);
    expect(() => loadConfig({ KNOWLEDGE_COPILOT_PUBLIC_BASE_URL: "file:\/\/local" })).toThrow(/http/);
  });
});
