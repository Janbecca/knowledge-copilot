# Security, identity, and capture consent

Last updated: 2026-08-29

## Product boundary

Knowledge Copilot is a cloud knowledge service plus an optional desktop agent. The desktop agent may wake the floating cockpit and forward explicitly authorized conversation text. It is not a general-purpose screen monitor, keylogger, clipboard watcher, or screenshot archive.

The system has four trust boundaries:

1. A host adapter (ChatGPT browser extension, MCP-capable CLI, or a future WorkBuddy adapter) observes only the conversation that the user granted.
2. The local desktop agent verifies the adapter, shows an active-capture indicator, applies local redaction, and forwards events.
3. The cloud API verifies user, device, session ownership, consent scope, and replay protection before accepting an event.
4. The selected extractor either accepts structured knowledge from the current host AI or calls the user's configured server-side LLM. Both paths converge on the same validated schema.

## Identity decision

Production authentication uses an established OAuth/OIDC identity provider rather than a home-grown password system. The resource server is provider-neutral and validates JWT signature, issuer, audience, expiry, and scopes from the provider's JWKS. Auth0 is the initial deployment target, but the implementation must not depend on Auth0-only token claims.

Required API scopes:

- `knowledge:read`: read sessions, cards, and exports owned by the subject.
- `knowledge:write`: create and modify owned sessions and knowledge.
- `device:manage`: pair, list, rename, and revoke desktop devices.
- `capture:write`: submit an authorized conversation turn from a paired device or host adapter.

ChatGPT and other remote MCP clients authenticate through OAuth 2.1 with PKCE. CLI adapters use a browser-based device-pairing flow; raw user passwords and long-lived OAuth access tokens are never stored by the desktop agent.

Local development may use `KNOWLEDGE_COPILOT_AUTH_MODE=disabled`. Production must use `oidc` before multi-user capture is enabled.

## Ownership model

- Every authenticated subject maps to one local user record.
- Every new learning session has exactly one owner.
- Cards, turns, exports, wake requests, devices, and consent grants are reachable only through that owner.
- Existing pre-account sessions remain unclaimed and inaccessible when production authentication is enabled until an explicit migration/claim operation is performed.
- An MCP transport is bound to the authenticated subject established at initialization. A later request cannot switch subjects on the same transport.

## Consent model

Capture is off by default. A grant is scoped by user, host, device, and optionally a specific source conversation. Grants do not silently expand from one host or conversation to another.

The desktop agent must always provide:

- a visible capturing/paused/stopped state;
- a one-click pause and stop control;
- the current host, conversation, destination session, and extraction mode;
- a local preview of the text about to be sent;
- configurable redaction before network transfer;
- a revocation screen for every device and grant.

The first-party default prohibits global screen capture, keyboard hooks, clipboard polling, password-field access, unrelated-window inspection, and screenshot retention. Windows UI Automation is an optional compatibility fallback and must require a separate, time-bounded grant; it is not part of the initial implementation.

## Adapter priority

1. Official MCP/tool or host lifecycle hooks.
2. A ChatGPT browser extension that reads only the active conversation DOM after per-conversation consent and communicates with the desktop agent through native messaging.
3. A host-specific supported API/plugin surface for WorkBuddy.
4. Windows UI Automation only after a separate security review and explicit user opt-in.

Claude Code and Codex should use their MCP/tool integration before any UI reading. This is more stable and exposes a narrower data surface than accessibility scraping.

## Wake protocol

`knowledge-copilot://wake?...` is a notification and routing channel, not an authentication credential. The cloud service issues a high-entropy, short-lived, single-use wake token. Only its SHA-256 hash is stored. The desktop agent consumes it over HTTPS, receives the authorized session/host intent, then the token becomes unusable.

Deep links must not contain conversation text, API keys, OAuth access tokens, or durable device secrets. If the operating system reports that the custom protocol is unavailable, the web UI shows a signed installer page and a manual continue option; browsers cannot reliably prove installation or launch success without a companion extension.

## Device security

- Device credentials are random, revocable, separately scoped, and stored using the Windows credential vault/keychain in production.
- The server stores only a one-way token hash.
- Device credentials never authorize account administration.
- Pairing codes and wake tokens expire quickly and are single use.
- Revoked devices and grants are rejected immediately.
- Capture requests include an idempotency key so retries cannot duplicate knowledge.

## Data minimization and audit

- Prefer completed text turns over screenshots or raw UI trees.
- Send only the selected conversation and tool observations needed for extraction.
- Do not log bearer tokens, device credentials, DeepSeek keys, wake tokens, or full conversation bodies.
- Record security metadata for grant creation/revocation, device pairing/revocation, wake-token consumption, and rejected cross-owner access.
- Account deletion and retention controls are required before public multi-user launch.

## Delivery phases

1. Identity/resource-server verification, ownership schema, device/consent records, and one-time wake tokens.
2. Desktop custom protocol, secure credential storage, capture indicator, pause/stop, and installer fallback.
3. ChatGPT browser extension with explicit per-conversation consent and native messaging.
4. Official-interface adapters for Claude Code, Codex, and WorkBuddy.
5. Optional accessibility fallback only after threat-model review and a dedicated consent UX.
