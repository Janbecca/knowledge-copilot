# Deployment

M1 provides a single-instance Beta deployment. The application listens on plain HTTP inside the private container network; Caddy terminates public HTTPS. SQLite is mounted on a persistent volume and is not suitable for multi-instance production use.

## Required inputs

- A DNS name whose A/AAAA record points to the deployment host.
- Inbound ports 80 and 443.
- `KNOWLEDGE_COPILOT_DOMAIN`, for example `knowledge.example.com`.
- Exact comma-separated `KNOWLEDGE_COPILOT_CORS_ORIGINS` when browser origins need access.
- The domain verification value in `KNOWLEDGE_COPILOT_APPS_CHALLENGE` when provided by OpenAI.

Do not put API keys or long-lived credentials in `compose.yaml` or Git. Inject them with the deployment platform's secret manager.

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
```

The MCP endpoint is `https://<domain>/mcp`; the standalone panel is `/app/`. Caddy limits request bodies to 1 MB and applies a 30-second upstream response-header timeout. The application independently validates its request limit, request timeout, exact CORS allowlist, and fixed-window rate limit.

## Shutdown and persistence

`docker compose down` sends SIGTERM. The process stops accepting requests, closes active MCP transports, closes idle HTTP connections, and then closes SQLite. The named `knowledge_data` volume survives container recreation. Back up the volume before destructive host maintenance; M2 will replace this local persistence model with a managed relational database and explicit RPO/RTO procedures.
