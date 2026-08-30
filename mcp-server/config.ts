import { resolve } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type AuthMode = "disabled" | "oidc";
export interface RuntimeConfig {
  environment: "development" | "test" | "production";
  host: string; port: number; publicBaseUrl?: string; database: string; logLevel: LogLevel;
  bodyLimitBytes: number; requestTimeoutMs: number; rateLimitMax: number; rateLimitWindowMs: number;
  corsOrigins: string[]; appsChallenge?: string;
  authMode: AuthMode; oidcIssuer?: string; oidcAudience?: string; oidcJwksUrl?: string; oidcClientId?: string;
  desktopInstallerUrl?: string;
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, minimum = 1): number {
  const raw = env[name]; const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}.`);
  return value;
}
function url(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  let parsed: URL; try { parsed = new URL(value); } catch { throw new Error(`${name} must be an absolute http(s) URL.`); }
  if (!(["http:", "https:"] as string[]).includes(parsed.protocol)) throw new Error(`${name} must be an absolute http(s) URL.`);
  return parsed.href.replace(/\/$/, "");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const rawEnvironment = env.NODE_ENV ?? "development";
  if (!(rawEnvironment === "development" || rawEnvironment === "test" || rawEnvironment === "production")) throw new Error("NODE_ENV must be development, test, or production.");
  const logLevel = env.KNOWLEDGE_COPILOT_LOG_LEVEL ?? "info";
  if (!(logLevel === "debug" || logLevel === "info" || logLevel === "warn" || logLevel === "error")) throw new Error("KNOWLEDGE_COPILOT_LOG_LEVEL must be debug, info, warn, or error.");
  const corsOrigins = (env.KNOWLEDGE_COPILOT_CORS_ORIGINS ?? "").split(",").map(origin => origin.trim()).filter(Boolean).map(origin => url(origin, "KNOWLEDGE_COPILOT_CORS_ORIGINS")!);
  const authMode = env.KNOWLEDGE_COPILOT_AUTH_MODE ?? "disabled";
  if (!(authMode === "disabled" || authMode === "oidc")) throw new Error("KNOWLEDGE_COPILOT_AUTH_MODE must be disabled or oidc.");
  const oidcIssuerBase = url(env.KNOWLEDGE_COPILOT_OIDC_ISSUER, "KNOWLEDGE_COPILOT_OIDC_ISSUER");
  const oidcIssuer = oidcIssuerBase ? `${oidcIssuerBase}/` : undefined;
  const oidcAudience = env.KNOWLEDGE_COPILOT_OIDC_AUDIENCE?.trim() || undefined;
  const oidcJwksUrl = url(env.KNOWLEDGE_COPILOT_OIDC_JWKS_URL, "KNOWLEDGE_COPILOT_OIDC_JWKS_URL");
  if (authMode === "oidc" && (!oidcIssuer || !oidcAudience)) throw new Error("OIDC auth requires KNOWLEDGE_COPILOT_OIDC_ISSUER and KNOWLEDGE_COPILOT_OIDC_AUDIENCE.");
  return {
    environment: rawEnvironment,
    host: env.KNOWLEDGE_COPILOT_HOST ?? (rawEnvironment === "production" ? "0.0.0.0" : "127.0.0.1"),
    port: integer(env, "KNOWLEDGE_COPILOT_PORT", 3210),
    publicBaseUrl: url(env.KNOWLEDGE_COPILOT_PUBLIC_BASE_URL, "KNOWLEDGE_COPILOT_PUBLIC_BASE_URL"),
    database: env.KNOWLEDGE_COPILOT_DB ?? resolve("data/knowledge-copilot.sqlite"),
    logLevel,
    bodyLimitBytes: integer(env, "KNOWLEDGE_COPILOT_BODY_LIMIT_BYTES", 1_048_576),
    requestTimeoutMs: integer(env, "KNOWLEDGE_COPILOT_REQUEST_TIMEOUT_MS", 30_000),
    rateLimitMax: integer(env, "KNOWLEDGE_COPILOT_RATE_LIMIT_MAX", 120),
    rateLimitWindowMs: integer(env, "KNOWLEDGE_COPILOT_RATE_LIMIT_WINDOW_MS", 60_000),
    corsOrigins,
    appsChallenge: env.KNOWLEDGE_COPILOT_APPS_CHALLENGE || undefined,
    authMode,
    oidcIssuer,
    oidcAudience,
    oidcJwksUrl,
    oidcClientId: env.KNOWLEDGE_COPILOT_OIDC_CLIENT_ID?.trim() || undefined,
    desktopInstallerUrl: url(env.KNOWLEDGE_COPILOT_DESKTOP_INSTALLER_URL, "KNOWLEDGE_COPILOT_DESKTOP_INSTALLER_URL"),
  };
}
