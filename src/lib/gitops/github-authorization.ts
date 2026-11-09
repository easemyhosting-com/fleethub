import { createHash, randomBytes } from "node:crypto";
import type { TransactionSql } from "postgres";
import { z } from "zod";
import { queryClient } from "@/lib/db/client";
import { builtinKey, createBuiltinVault, secretRows } from "@/lib/vault/builtin";

const tokenUrl = "https://github.com/login/oauth/access_token";
const callbackPath = "/api/gitops/github/callback";
const flowLifetimeMs = 10 * 60_000;
const refreshBufferMs = 60_000;
const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const credentialsSchema = z.object({
  access: z.string().regex(/^ghu_[A-Za-z0-9_-]{1,508}$/),
  refresh: z.string().regex(/^ghr_[A-Za-z0-9_-]{1,508}$/),
  expiresAt: z.number().int().positive(),
  refreshExpiresAt: z.number().int().positive(),
});
const tokenResponse = z.object({
  access_token: credentialsSchema.shape.access,
  refresh_token: credentialsSchema.shape.refresh,
  expires_in: z.number().int().positive().max(28_800),
  refresh_token_expires_in: z.number().int().positive().max(15_897_600),
  token_type: z.literal("bearer"),
});
type Credentials = z.infer<typeof credentialsSchema>;
type App = { id: string; secret: string };
type Operator = { id: string; sid: string };

export class GithubAuthorizationError extends Error {
  constructor(readonly code: "not_configured" | "reconnect" | "invalid_refresh" | "unavailable") { super(code); }
}

function githubApp(): App | null {
  const id = process.env.FLEETHUB_GITHUB_APP_CLIENT_ID?.trim();
  const secret = process.env.FLEETHUB_GITHUB_APP_CLIENT_SECRET?.trim();
  if (!id || !/^[A-Za-z0-9._-]{1,128}$/.test(id) || !secret) return null;
  try { builtinKey(); } catch { return null; }
  return { id, secret };
}

function requireApp(): App {
  const app = githubApp();
  if (!app) throw new GithubAuthorizationError("not_configured");
  return app;
}

function callbackUrl(origin: string): string {
  const callback = new URL(callbackPath, origin);
  if (callback.protocol !== "https:" && !(callback.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(callback.hostname))) {
    throw new GithubAuthorizationError("not_configured");
  }
  return callback.href;
}

const stateKey = (app: App, operator: Operator, state: string) => digest(JSON.stringify(["github", app.id, operator.id, operator.sid, state]));

export async function startGithubAuthorization(operator: Operator, origin: string): Promise<string> {
  const app = requireApp();
  const redirect = callbackUrl(origin);
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const issuedAt = Date.now();
  await queryClient`DELETE FROM oauth_transactions WHERE issued_at < ${issuedAt - flowLifetimeMs}`;
  await queryClient`INSERT INTO oauth_transactions (state_hash, verifier, issued_at) VALUES (${stateKey(app, operator, state)}, ${verifier}, ${issuedAt})`;
  const params = new URLSearchParams({
    client_id: app.id, redirect_uri: redirect, state, scope: "offline_access",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

async function exchange(app: App, params: Record<string, string>): Promise<Credentials> {
  const response = await fetch(tokenUrl, {
    method: "POST", headers: { Accept: "application/json" }, redirect: "error",
    body: new URLSearchParams({ client_id: app.id, client_secret: app.secret, ...params }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => { throw new GithubAuthorizationError("unavailable"); });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok && (response.status === 429 || response.status >= 500)) throw new GithubAuthorizationError("unavailable");
  const refreshing = params.grant_type === "refresh_token";
  if (refreshing && z.object({ error: z.literal("bad_refresh_token") }).safeParse(body).success) {
    throw new GithubAuthorizationError("invalid_refresh");
  }
  const token = tokenResponse.safeParse(body);
  if (!response.ok || !token.success) throw new GithubAuthorizationError(refreshing ? "unavailable" : "reconnect");
  const now = Date.now();
  return {
    access: token.data.access_token, refresh: token.data.refresh_token,
    expiresAt: now + token.data.expires_in * 1000,
    refreshExpiresAt: now + token.data.refresh_token_expires_in * 1000,
  };
}

/** Keep refresh, replacement and revocation for this operator serialized across web instances. */
async function withConnection<T>(app: App, userId: string, action: (tx: TransactionSql, name: string) => Promise<T>): Promise<T> {
  const name = `FLEETHUB_GITHUB_APP_${digest(JSON.stringify([app.id, userId]))}`;
  const result = await queryClient.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${name}, 0))`;
    return { value: await action(tx, name) };
  });
  return result.value;
}

async function storedConnection(tx: TransactionSql, name: string) {
  const rows = secretRows(tx);
  const vault = createBuiltinVault(rows);
  const credentials = await rows.get(name) ? credentialsSchema.parse(JSON.parse(await vault.read(name))) : null;
  return { vault, credentials };
}

export async function finishGithubAuthorization(operator: Operator, origin: string, state: string | null, code: string | null) {
  const app = requireApp();
  if (!opaque.safeParse(state).success || !state) return false;
  const [row] = await queryClient`DELETE FROM oauth_transactions WHERE state_hash = ${stateKey(app, operator, state)}
    AND issued_at >= ${Date.now() - flowLifetimeMs} RETURNING verifier`;
  const verifier = opaque.safeParse(row?.verifier);
  if (!verifier.success || !code || code.length > 512) return false;
  await withConnection(app, operator.id, async (tx, name) => {
    const credentials = await exchange(app, { code, code_verifier: verifier.data, redirect_uri: callbackUrl(origin) });
    await createBuiltinVault(secretRows(tx)).write(name, JSON.stringify(credentials));
  });
  return true;
}

export async function githubConnectionStatus(userId: string) {
  const app = githubApp();
  if (!app) return "not_configured";
  return withConnection(app, userId, async (tx, name) => {
    const { credentials } = await storedConnection(tx, name);
    if (!credentials) return "disconnected";
    return credentials.refreshExpiresAt > Date.now() ? "connected" : "reconnect";
  });
}

async function refresh(app: App, credentials: Credentials): Promise<Credentials> {
  if (credentials.refreshExpiresAt <= Date.now()) throw new GithubAuthorizationError("reconnect");
  return exchange(app, { grant_type: "refresh_token", refresh_token: credentials.refresh });
}

export async function githubReadToken(userId: string): Promise<string | undefined> {
  const app = githubApp();
  if (!app) return undefined;
  return withConnection(app, userId, async (tx, name) => {
    const { vault, credentials } = await storedConnection(tx, name);
    if (!credentials) return undefined;
    if (credentials.expiresAt > Date.now() + refreshBufferMs) return credentials.access;
    const next = await refresh(app, credentials);
    await vault.write(name, JSON.stringify(next));
    return next.access;
  });
}

export async function disconnectGithubAuthorization(userId: string): Promise<"revoked" | "expired" | "absent"> {
  const app = requireApp();
  // Commit any rotated token even if GitHub's subsequent grant deletion fails.
  const outcome = await withConnection(app, userId, async (tx, name) => {
    const { vault, credentials } = await storedConnection(tx, name);
    if (!credentials) return "absent";
    const now = Date.now();
    if (credentials.expiresAt <= now && credentials.refreshExpiresAt <= now) {
      await vault.remove(name);
      return "expired";
    }
    let current = credentials;
    if (current.expiresAt <= now || (current.expiresAt <= now + refreshBufferMs && current.refreshExpiresAt > now)) {
      try {
        current = await refresh(app, current);
      } catch (error) {
        if (!(error instanceof GithubAuthorizationError) || error.code !== "invalid_refresh") throw error;
        if (current.expiresAt <= now) {
          await vault.remove(name);
          return "expired";
        }
      }
      if (current !== credentials) await vault.write(name, JSON.stringify(current));
    }
    const response = await fetch(`https://api.github.com/applications/${encodeURIComponent(app.id)}/grant`, {
      method: "DELETE", redirect: "error", signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/vnd.github+json", "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${app.id}:${app.secret}`).toString("base64")}` },
      body: JSON.stringify({ access_token: current.access }),
    }).catch(() => null);
    if (response?.status !== 204) return "unavailable";
    await vault.remove(name);
    return "revoked";
  });
  if (outcome === "unavailable") throw new GithubAuthorizationError(outcome);
  return outcome;
}
