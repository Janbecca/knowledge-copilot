import { describe, expect, it } from "vitest";
import { loadConfig } from "../../mcp-server/config.js";

describe("OIDC issuer normalization", () => {
  it("preserves the canonical trailing slash required by Auth0 issuer claims", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      KNOWLEDGE_COPILOT_AUTH_MODE: "oidc",
      KNOWLEDGE_COPILOT_OIDC_ISSUER: "https://dev-example.us.auth0.com",
      KNOWLEDGE_COPILOT_OIDC_AUDIENCE: "https://knowledge-copilot.xyz",
    });

    expect(config.oidcIssuer).toBe("https://dev-example.us.auth0.com/");
  });

  it("does not duplicate an existing trailing slash", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      KNOWLEDGE_COPILOT_AUTH_MODE: "oidc",
      KNOWLEDGE_COPILOT_OIDC_ISSUER: "https://dev-example.us.auth0.com/",
      KNOWLEDGE_COPILOT_OIDC_AUDIENCE: "https://knowledge-copilot.xyz",
    });

    expect(config.oidcIssuer).toBe("https://dev-example.us.auth0.com/");
  });
});
