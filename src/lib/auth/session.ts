import crypto from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { refreshRuntimeEnv } from "@/lib/config/runtime-env";

const pbkdf2 = promisify(crypto.pbkdf2);

const SESSION_COOKIE_NAME = "fleethub_session";
const OAUTH_COOKIE_NAME = "fleethub_google_oauth";
const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;
const DEVICE_SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;
const OAUTH_MAX_AGE_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;
const TOKEN_PATTERN = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/;

function authSecret(): Buffer | null {
  const value = process.env.FLEETHUB_AUTH_SECRET;
  if (!value || Buffer.byteLength(value, "utf8") < 32) return null;
  return Buffer.from(value, "utf8");
}

export function hasAuthSecret(): boolean {
  return authSecret() !== null;
}

function requireAuthSecret(): Buffer {
  const secret = authSecret();
  if (!secret) throw new Error("FLEETHUB_AUTH_SECRET must contain at least 32 UTF-8 bytes");
  return secret;
}

function sign(payload: string, secret: Buffer): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function verifySignedValue(value: string, secret: Buffer): string | null {
  if (value.length > 4096) return null;
  const match = TOKEN_PATTERN.exec(value);
  if (!match) return null;
  const [, payload, signature] = match;
  const actual = Buffer.from(signature, "base64url");
  if (actual.toString("base64url") !== signature) return null;
  const expected = Buffer.from(sign(payload, secret), "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  if (Buffer.from(payload, "base64url").toString("base64url") !== payload) return null;
  return payload;
}

const emailSchema = z.string().max(320).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
const sessionUserSchema = z.strictObject({
  id: z.string().min(1).max(256),
  email: emailSchema,
  name: z.string().max(256),
  provider: z.enum(["local", "google"]),
  createdAt: z.number().refine(Number.isSafeInteger),
  sid: z.string().regex(/^ses-[0-9a-f-]{36}$/).optional(),
  exp: z.number().refine(Number.isSafeInteger).optional(),
});
const oauthStateSchema = z.strictObject({
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  issuedAt: z.number().refine(Number.isSafeInteger),
});
const googleTokenSchema = z.object({ access_token: z.string().min(1) });
const googleUserInfoSchema = z.object({
  sub: z.string().min(1).max(256),
  email: emailSchema,
  email_verified: z.literal(true),
  name: z.string().optional(),
});

export type SessionUser = z.infer<typeof sessionUserSchema>;

export const isProxyIdentity = (user: SessionUser) => user.id.startsWith("proxy:");

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const iterations = 100000;
  const hash = (await pbkdf2(password, salt, iterations, 64, "sha512")).toString("hex");
  return `${salt}:${iterations}:${hash}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const parts = storedHash.split(":");
    if (parts.length !== 3) return false;
    const [salt, iterationsStr, hash] = parts;
    if (!/^[a-f0-9]{32}$/.test(salt) || !/^[1-9]\d*$/.test(iterationsStr) || !/^[a-f0-9]{128}$/.test(hash)) return false;
    const iterations = Number(iterationsStr);
    if (!Number.isSafeInteger(iterations) || iterations < 100000 || iterations > 1000000) return false;
    const candidate = await pbkdf2(password, salt, iterations, 64, "sha512");
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), candidate);
  } catch {
    return false;
  }
}

export function createSessionToken(user: SessionUser): string {
  if (!sessionUserSchema.safeParse(user).success) throw new Error("Invalid session user");
  const payload = Buffer.from(JSON.stringify(user)).toString("base64url");
  return `${payload}.${sign(payload, requireAuthSecret())}`;
}

export function verifySessionToken(token: string): SessionUser | null {
  try {
    const secret = authSecret();
    if (!secret) return null;
    const payload = verifySignedValue(token, secret);
    if (!payload) return null;
    const result = sessionUserSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (!result.success) return null;
    const user = result.data;
    const now = Date.now();
    const lifetimeMs = user.exp === undefined ? SESSION_MAX_AGE_SEC * 1000 : Math.min(user.exp - user.createdAt, DEVICE_SESSION_MAX_AGE_SEC * 1000);
    if (user.createdAt > now + CLOCK_SKEW_MS || lifetimeMs <= 0 || now - user.createdAt > lifetimeMs) return null;
    return user;
  } catch {
    return null;
  }
}

export function getCookie(req: Request, name: string): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const segment of cookieHeader.split(";")) {
    const [key, ...value] = segment.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

export function getSessionFromRequest(req: Request): SessionUser | null {
  if (process.env.FLEETHUB_TRUST_PROXY_AUTH === "true") {
    const proxyEmail = req.headers.get("x-auth-request-email") || req.headers.get("x-forwarded-email");
    const configuredSecret = process.env.FLEETHUB_PROXY_AUTH_SECRET;
    const suppliedSecret = req.headers.get("x-fleethub-proxy-secret");
    const allowed = (process.env.FLEETHUB_ALLOWED_EMAILS || "").split(",").some((email) => email.trim().toLowerCase() === proxyEmail?.toLowerCase());
    if (proxyEmail && allowed && configuredSecret && suppliedSecret && Buffer.byteLength(configuredSecret, "utf8") >= 32
      && Buffer.byteLength(suppliedSecret, "utf8") === Buffer.byteLength(configuredSecret, "utf8")
      && crypto.timingSafeEqual(Buffer.from(suppliedSecret), Buffer.from(configuredSecret))) {
      const proxyUser = req.headers.get("x-auth-request-user") || proxyEmail.split("@")[0];
      return { id: `proxy:${proxyEmail}`, email: proxyEmail, name: proxyUser, provider: "google", createdAt: Date.now() };
    }
  }
  const token = getCookie(req, SESSION_COOKIE_NAME);
  return token ? verifySessionToken(token) : null;
}

export function getCanonicalOrigin(req: Request): string {
  refreshRuntimeEnv();
  const configured = process.env.FLEETHUB_APP_URL;
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("FLEETHUB_APP_URL must be configured in production");
  }
  const url = new URL(configured || req.url);
  if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || (configured && (url.pathname !== "/" || url.search || url.hash))) {
    throw new Error("FLEETHUB_APP_URL must be a plain HTTP(S) origin");
  }
  return url.origin;
}

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The canonical origin plus any exact extra origins from FLEETHUB_ALLOWED_ORIGINS (https, or http on loopback only). Invalid entries are ignored. */
export function getAllowedOrigins(req: Request): string[] {
  const extra = (process.env.FLEETHUB_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean).flatMap((value) => {
    try {
      const url = new URL(value);
      const plain = url.origin === value.replace(/\/$/, "") && !url.username && !url.password;
      const permitted = url.protocol === "https:" || (url.protocol === "http:" && loopbackHosts.has(url.hostname));
      return plain && permitted ? [url.origin] : [];
    } catch { return []; }
  });
  return [...new Set([getCanonicalOrigin(req), ...extra])];
}

export function isAllowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return origin !== null && getAllowedOrigins(req).includes(origin);
}

export function isSecureRequest(req?: Request): boolean {
  if (req) {
    const allowed = getAllowedOrigins(req);
    const origin = req.headers.get("origin");
    return (origin !== null && allowed.includes(origin) ? origin : allowed[0]).startsWith("https://");
  }
  return process.env.FLEETHUB_APP_URL ? new URL(process.env.FLEETHUB_APP_URL).protocol === "https:" : false;
}

function cookie(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function createSessionCookie(token: string, requestOrSecure?: Request | boolean, maxAgeSec = SESSION_MAX_AGE_SEC): string {
  const secure = typeof requestOrSecure === "boolean" ? requestOrSecure : isSecureRequest(requestOrSecure);
  return cookie(SESSION_COOKIE_NAME, token, Math.min(maxAgeSec, DEVICE_SESSION_MAX_AGE_SEC), secure);
}

export function createClearSessionCookie(req?: Request): string {
  return cookie(SESSION_COOKIE_NAME, "", 0, isSecureRequest(req));
}

export function isGoogleAuthEnabled(): boolean {
  if (process.env.FLEETHUB_GOOGLE_AUTH_ENABLED === "false") return false;
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && hasAuthSecret());
}

export function getGoogleRedirectUri(origin: string): string {
  return process.env.GOOGLE_REDIRECT_URI || `${origin}/api/auth/callback/google`;
}

export function getGoogleOAuthUrl(origin: string, state?: string, codeChallenge?: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: getGoogleRedirectUri(origin),
    response_type: "code",
    scope: "openid email profile",
    state: state || crypto.randomBytes(32).toString("base64url"),
    code_challenge: codeChallenge || crypto.randomBytes(32).toString("base64url"),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function createGoogleOAuthFlow(origin: string, req: Request): Promise<{ url: string; cookie: string }> {
  const { queryClient } = await import("@/lib/db/client");
  const secret = requireAuthSecret();
  const state = crypto.randomBytes(32).toString("base64url");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const issuedAt = Date.now();
  const stateHash = crypto.createHash("sha256").update(state).digest("hex");
  await queryClient`DELETE FROM oauth_transactions WHERE issued_at < ${issuedAt - OAUTH_MAX_AGE_MS};`;
  await queryClient`INSERT INTO oauth_transactions (state_hash, verifier, issued_at) VALUES (${stateHash}, ${verifier}, ${issuedAt});`;
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const payload = Buffer.from(JSON.stringify({ state, issuedAt })).toString("base64url");
  return {
    url: getGoogleOAuthUrl(origin, state, challenge),
    cookie: cookie(OAUTH_COOKIE_NAME, `${payload}.${sign(payload, secret)}`, OAUTH_MAX_AGE_MS / 1000, isSecureRequest(req)),
  };
}

export function clearGoogleOAuthCookie(req: Request): string {
  return cookie(OAUTH_COOKIE_NAME, "", 0, isSecureRequest(req));
}

export async function consumeGoogleOAuthFlow(req: Request, state: string | null): Promise<string | null> {
  const secret = authSecret();
  if (!secret || !state || !/^[A-Za-z0-9_-]{43}$/.test(state)) return null;
  const signedCookie = getCookie(req, OAUTH_COOKIE_NAME);
  if (!signedCookie) return null;
  const payload = verifySignedValue(signedCookie, secret);
  if (!payload) return null;
  try {
    const parsed = oauthStateSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (!parsed.success || parsed.data.state !== state) return null;
    const issuedAt = parsed.data.issuedAt;
    const now = Date.now();
    if (issuedAt > now + CLOCK_SKEW_MS || now - issuedAt > OAUTH_MAX_AGE_MS) return null;
    const { queryClient } = await import("@/lib/db/client");
    const stateHash = crypto.createHash("sha256").update(state).digest("hex");
    const consumed = await queryClient`
      DELETE FROM oauth_transactions
      WHERE state_hash = ${stateHash} AND issued_at = ${issuedAt}
      RETURNING verifier;
    `;
    const verifier = consumed[0]?.verifier;
    return typeof verifier === "string" && /^[A-Za-z0-9_-]{43}$/.test(verifier) ? verifier : null;
  } catch {
    return null;
  }
}

export interface GoogleUser { sub: string; email: string; name: string }

export async function exchangeGoogleCodeForUser(code: string, origin: string, codeVerifier: string): Promise<GoogleUser | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret || !/^[A-Za-z0-9_-]{43}$/.test(codeVerifier)) return null;
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: getGoogleRedirectUri(origin), grant_type: "authorization_code", code_verifier: codeVerifier }).toString(),
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    if (!tokenRes.ok) return null;
    const tokenData = googleTokenSchema.safeParse(await tokenRes.json());
    if (!tokenData.success) return null;
    const userinfoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.data.access_token}` },
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    if (!userinfoRes.ok) return null;
    const userData = googleUserInfoSchema.safeParse(await userinfoRes.json());
    if (!userData.success) return null;
    const name = userData.data.name?.trim() || userData.data.email.split("@")[0];
    return { sub: userData.data.sub, email: userData.data.email.toLowerCase(), name };
  } catch {
    return null;
  }
}
