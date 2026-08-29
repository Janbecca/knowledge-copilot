import type { IncomingMessage } from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { IdentityService, type AccessContext, type AccessScope } from "../packages/identity/index.js";
import type { RuntimeConfig } from "./config.js";

export class AuthenticationError extends Error {
  constructor(readonly status: 401 | 403, message: string) { super(message); }
}

const allScopes: ReadonlySet<string> = new Set<AccessScope>(["knowledge:read", "knowledge:write", "device:manage", "capture:write"]);

export class RequestAuthenticator {
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;
  constructor(readonly config: RuntimeConfig, readonly identity: IdentityService) {
    if (config.authMode === "oidc") {
      const jwksUrl = config.oidcJwksUrl ?? `${config.oidcIssuer}/.well-known/jwks.json`;
      this.jwks = createRemoteJWKSet(new URL(jwksUrl));
    }
  }

  async authenticate(req: IncomingMessage): Promise<AccessContext> {
    if (this.config.authMode === "disabled") return { subject: "local-development", userId: null, scopes: allScopes, authType: "development" };
    const authorization = req.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) throw new AuthenticationError(401, "bearer access token required");
    const token = authorization.slice(7).trim();
    if (token.startsWith("kc_device_")) {
      const device = this.identity.authenticateDevice(token);
      if (!device) throw new AuthenticationError(401, "invalid or revoked device credential");
      return device;
    }
    try {
      const { payload } = await jwtVerify(token, this.jwks!, { issuer: this.config.oidcIssuer, audience: this.config.oidcAudience });
      if (!payload.sub) throw new AuthenticationError(401, "access token subject is required");
      const user = this.identity.ensureUser(payload.sub, { displayName: typeof payload.name === "string" ? payload.name : undefined, email: typeof payload.email === "string" ? payload.email : undefined });
      const rawScopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [];
      return { subject: payload.sub, userId: user.user_id, scopes: new Set(rawScopes), authType: "oidc" };
    } catch (error) {
      if (error instanceof AuthenticationError) throw error;
      throw new AuthenticationError(401, "invalid or expired access token");
    }
  }
}

export function requireScope(context: AccessContext, scope: AccessScope): void {
  if (!context.scopes.has(scope)) throw new AuthenticationError(403, `missing required scope: ${scope}`);
}

export function requireUser(context: AccessContext): string {
  if (!context.userId) throw new AuthenticationError(403, "authenticated user account required");
  return context.userId;
}
