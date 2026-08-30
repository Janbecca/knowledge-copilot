# Deployment

M1 provides a single-instance Beta deployment. The application listens on plain HTTP inside the private container network; Caddy terminates public HTTPS. SQLite is mounted on a persistent volume and is not suitable for multi-instance production use.

## Required inputs

- A DNS name whose A/AAAA record points to the deployment host.
- Inbound ports 80 and 443.
- `KNOWLEDGE_COPILOT_DOMAIN`, for example `knowledge.example.com`.
- Exact comma-separated `KNOWLEDGE_COPILOT_CORS_ORIGINS` when browser origins need access.
- The domain verification value in `KNOWLEDGE_COPILOT_APPS_CHALLENGE` when provided by OpenAI.

Do not put API keys or long-lived credentials in `compose.yaml` or Git. Inject them with the deployment platform's secret manager.

Public multi-user capture must enable OIDC and use a public SPA/native client with Authorization Code + PKCE. The API validates access tokens as a resource server; it does not store user passwords or mint login sessions. Configure:

```text
KNOWLEDGE_COPILOT_AUTH_MODE=oidc
KNOWLEDGE_COPILOT_OIDC_ISSUER=https://<tenant>/
KNOWLEDGE_COPILOT_OIDC_AUDIENCE=https://knowledge-copilot.xyz
KNOWLEDGE_COPILOT_OIDC_CLIENT_ID=<public-spa-client-id>
# Optional when discovery does not expose the expected endpoint:
KNOWLEDGE_COPILOT_OIDC_JWKS_URL=https://<tenant>/.well-known/jwks.json
KNOWLEDGE_COPILOT_DESKTOP_INSTALLER_URL=https://knowledge-copilot.xyz/downloads/Knowledge-Copilot-setup.exe
```

Register the exact panel redirect URI and logout URI with the identity provider. Keep capture disabled for public users until these values are live and a two-account ownership-isolation test has passed. `AUTH_MODE=disabled` is only the single-user migration/local-development posture.

The protected-resource metadata advertises `KNOWLEDGE_COPILOT_OIDC_AUDIENCE` as its canonical `resource`. Keep that value identical to the Auth0 API Identifier; ChatGPT sends it as the OAuth `resource` parameter and the API verifies the same value in the access-token `aud` claim. The transport endpoint remains `/mcp` and does not need to be the resource identifier.

For Auth0, create a custom API whose Identifier is exactly `https://knowledge-copilot.xyz` and define `knowledge:read`, `knowledge:write`, `device:manage`, and `capture:write` permissions. Create a Single Page Application with exact values: callback/logout `https://knowledge-copilot.xyz/app/`, web origin and CORS origin `https://knowledge-copilot.xyz`. The panel sends the API Identifier as the OAuth `audience`; omitting it produces a token intended for Auth0 `/userinfo`, which the knowledge API must reject.

For ChatGPT/Codex MCP OAuth, enable Auth0's **Resource Parameter Compatibility Profile** and **Include Issuer in Authorization Responses** tenant settings. Auth0's current CIMD importer ignores ChatGPT's plural `token_endpoint_auth_methods_supported` field and maps the legacy preference to `private_key_jwt`, which Auth0 documents as Enterprise-only; do not create that imported client on a non-Enterprise plan. The current custom-MCP creation UI discovers authentication from the protected-resource and authorization-server metadata during tool scanning and does not expose predefined OAuth client fields. Treat Dynamic Client Registration as a fallback only: Auth0's open DCR endpoint permits unauthenticated client registration and strict third-party clients require explicit API grants and domain-level login connections. If DCR is used for a controlled initial registration, configure only user-delegated permissions, never client/M2M access, and disable DCR immediately afterward. Keep the Auth0 issuer's canonical trailing slash in token validation; the runtime normalizes the configured issuer accordingly.

To enable the per-session `server_llm` option, inject these server-only variables before starting Compose:

```text
KNOWLEDGE_COPILOT_EXTRACTOR=llm
KNOWLEDGE_COPILOT_BASE_URL=https://api.deepseek.com
KNOWLEDGE_COPILOT_API_KEY=<secret-manager-or-private-env-file>
KNOWLEDGE_COPILOT_MODEL=deepseek-v4-flash
KNOWLEDGE_COPILOT_MAX_REPAIRS=1
```

If the global extractor remains `mock`, the UI can still select `server_llm`, but it runs the deterministic development extractor. `/ready` reports the active extractor name. The default per-session mode remains `host_structured` regardless of provider configuration.

## Start

```powershell
$env:KNOWLEDGE_COPILOT_DOMAIN='knowledge.example.com'
$env:KNOWLEDGE_COPILOT_CORS_ORIGINS='https://chatgpt.com'
docker compose up --build -d
```

Verify:

```powershell
Invoke-RestMethod https://knowledge.example.com/health
Invoke-RestMethod https://knowledge.example.com/ready
Invoke-WebRequest https://knowledge.example.com/.well-known/openai-apps-challenge
Invoke-RestMethod https://knowledge.example.com/.well-known/oauth-protected-resource
Invoke-RestMethod https://knowledge.example.com/api/auth/config
```

The MCP endpoint is `https://<domain>/mcp`; the standalone panel is `/app/`. Caddy limits request bodies to 1 MB and applies a 30-second upstream response-header timeout. The application independently validates its request limit, request timeout, exact CORS allowlist, and fixed-window rate limit.

## Shutdown and persistence

`docker compose down` sends SIGTERM. The process stops accepting requests, closes active MCP transports, closes idle HTTP connections, and then closes SQLite. The named `knowledge_data` volume survives container recreation. Back up the volume before destructive host maintenance; M2 will replace this local persistence model with a managed relational database and explicit RPO/RTO procedures.
