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
