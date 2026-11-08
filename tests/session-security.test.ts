import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  oauth: new Map<string, { verifier: string; issuedAt: number }>(),
  users: new Map<string, string>(),
  failUserWrite: false,
  failOAuthConsume: false,
  bootstrapSuccess: true,
  limiter: "allow" as "allow" | "deny" | "fail",
}));

vi.mock("@/lib/auth/sessions", async importOriginal => (await import("./helpers/session-store-mock")).sessionStoreMock(await importOriginal<typeof import("../src/lib/auth/sessions")>()));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: vi.fn(async () => ({ success: database.bootstrapSuccess })) }));
vi.mock("@/lib/auth/guard", async (importOriginal) => {
 const original = await importOriginal<typeof import("../src/lib/auth/guard")>();
 return { ...original, checkAuthRateLimit: vi.fn(async () => {
  if (database.limiter === "fail") throw new Error("limiter unavailable");
  return database.limiter === "allow";
 }) };
});
vi.mock("@/lib/db/client", () => ({
  queryClient: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    if (sql.includes("DELETE FROM oauth_transactions WHERE issued_at")) {
      for (const [key, value] of database.oauth) if (value.issuedAt < Number(values[0])) database.oauth.delete(key);
      return [];
    }
    if (sql.includes("INSERT INTO oauth_transactions")) {
      database.oauth.set(String(values[0]), { verifier: String(values[1]), issuedAt: Number(values[2]) });
      return [];
    }
    if (sql.includes("DELETE FROM oauth_transactions")) {
      if (database.failOAuthConsume) throw new Error("oauth persistence unavailable");
      const pending = database.oauth.get(String(values[0]));
      if (!pending || pending.issuedAt !== Number(values[1])) return [];
      database.oauth.delete(String(values[0]));
      return [{ verifier: pending.verifier }];
    }
    if (sql.includes("SELECT id FROM app_users")) {
      const id = database.users.get(String(values[0]));
      return id ? [{ id }] : [];
    }
    if (sql.includes("INSERT INTO app_users")) {
      if (database.failUserWrite) throw new Error("database write failed");
      const id = database.users.get(String(values[3])) || String(values[0]);
      database.users.set(String(values[3]), id);
      return [{ id }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  },
}));

import {
  createSessionToken,
  verifySessionToken,
  createSessionCookie,
  createClearSessionCookie,
  getCanonicalOrigin,
  getSessionFromRequest,
  getCookie,
  hashPassword,
  verifyPassword,
  consumeGoogleOAuthFlow,
  exchangeGoogleCodeForUser,
} from "../src/lib/auth/session";
import { GET as beginGoogle } from "../src/app/api/auth/google/route";
import { GET as finishGoogle } from "../src/app/api/auth/callback/google/route";

const secret = "session-security-test-secret-32-bytes-minimum";
const env = { ...process.env };
const originalFetch = global.fetch;

function forgedToken(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

beforeEach(() => {
  process.env.FLEETHUB_AUTH_SECRET = secret;
  process.env.FLEETHUB_APP_URL = "https://fleet.example.com";
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  process.env.FLEETHUB_ALLOWED_EMAILS = "operator@example.com";
  database.oauth.clear();
  database.users.clear();
  database.failUserWrite = false;
  database.failOAuthConsume = false;
  database.bootstrapSuccess = true;
  database.limiter = "allow";
});

afterEach(() => {
  vi.unstubAllEnvs();
  process.env = { ...env };
  global.fetch = originalFetch;
});

describe("session token boundary", () => {
  const user = () => ({ id: "usr-1", email: "operator@example.com", name: "Operator", provider: "local" as const, createdAt: Date.now() });

  it("requires a dedicated 32-byte secret and fails verification closed", () => {
    const token = createSessionToken(user());
    delete process.env.FLEETHUB_AUTH_SECRET;
    process.env.FLEETHUB_API_KEY = "another-long-secret-that-must-not-sign-sessions";
    expect(verifySessionToken(token)).toBeNull();
    expect(() => createSessionToken(user())).toThrow(/FLEETHUB_AUTH_SECRET/);
    process.env.FLEETHUB_AUTH_SECRET = "short";
    expect(verifySessionToken(token)).toBeNull();
  });

  it("rejects malformed framing, malformed payloads, missing timestamps, and forged signatures", () => {
    const token = createSessionToken(user());
    expect(verifySessionToken(token)).toMatchObject({ id: "usr-1" });
    expect(verifySessionToken(`${token}.extra`)).toBeNull();
    expect(verifySessionToken(`${token}=`)).toBeNull();
    expect(verifySessionToken(token.replace(/.$/, "x"))).toBeNull();
    expect(verifySessionToken(forgedToken({ ...user(), createdAt: undefined }))).toBeNull();
    expect(verifySessionToken(forgedToken({ ...user(), provider: "admin" }))).toBeNull();
    expect(verifySessionToken(forgedToken({ ...user(), extra: true }))).toBeNull();
    expect(verifySessionToken(forgedToken({ ...user(), createdAt: "now" }))).toBeNull();
    const malformedJson = Buffer.from("{").toString("base64url");
    const signature = crypto.createHmac("sha256", secret).update(malformedJson).digest("base64url");
    expect(verifySessionToken(`${malformedJson}.${signature}`)).toBeNull();
    expect(verifySessionToken("x".repeat(4097))).toBeNull();
  });

  it("rejects old and future-issued sessions", () => {
    expect(verifySessionToken(forgedToken({ ...user(), createdAt: Date.now() - 8 * 86400000 }))).toBeNull();
    expect(verifySessionToken(forgedToken({ ...user(), createdAt: Date.now() + 120000 }))).toBeNull();
  });

  it("sets Secure from canonical HTTPS origin for issuance and deletion", () => {
    const req = new Request("http://internal:3000/api/auth");
    expect(getCanonicalOrigin(req)).toBe("https://fleet.example.com");
    expect(createSessionCookie("token", req)).toContain("; Secure");
    expect(createClearSessionCookie(req)).toContain("; Secure");
    delete process.env.FLEETHUB_APP_URL;
    expect(createSessionCookie("token", req)).not.toContain("; Secure");
  });

  it("requires a configured canonical origin in production", () => {
    delete process.env.FLEETHUB_APP_URL;
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getCanonicalOrigin(new Request("https://attacker.example/api/auth"))).toThrow(/FLEETHUB_APP_URL/);
  });

  it("rejects malformed configured origins and secures legacy cookie clearing", () => {
    const req = new Request("https://fleet.example.com/api/auth");
    process.env.FLEETHUB_APP_URL = "https://fleet.example.com/unsafe/path";
    expect(() => getCanonicalOrigin(req)).toThrow(/plain HTTP/);
    process.env.FLEETHUB_APP_URL = "https://fleet.example.com";
    expect(createClearSessionCookie()).toContain("; Secure");
  });

  it("accepts proxy identity only with a separate shared secret and allowlisted email", () => {
    process.env.FLEETHUB_TRUST_PROXY_AUTH = "true";
    process.env.FLEETHUB_PROXY_AUTH_SECRET = "proxy-auth-secret-with-at-least-32-bytes";
    const url = "https://fleet.example.com/api/fleet";
    const headers = { "x-auth-request-email": "operator@example.com" };
    expect(getSessionFromRequest(new Request(url, { headers }))).toBeNull();
    expect(getSessionFromRequest(new Request(url, { headers: { ...headers, "x-fleethub-proxy-secret": "wrong" } }))).toBeNull();
    expect(getSessionFromRequest(new Request(url, { headers: { ...headers, "x-fleethub-proxy-secret": process.env.FLEETHUB_PROXY_AUTH_SECRET } }))).toMatchObject({ email: "operator@example.com" });
    process.env.FLEETHUB_ALLOWED_EMAILS = "someone-else@example.com";
    expect(getSessionFromRequest(new Request(url, { headers: { ...headers, "x-fleethub-proxy-secret": process.env.FLEETHUB_PROXY_AUTH_SECRET } }))).toBeNull();
    process.env.FLEETHUB_ALLOWED_EMAILS = "operator@example.com";
    process.env.FLEETHUB_PROXY_AUTH_SECRET = "short";
    expect(getSessionFromRequest(new Request(url, { headers: { ...headers, "x-fleethub-proxy-secret": "short" } }))).toBeNull();
  });

  it("parses exact cookie names without accepting similar names", () => {
    const req = new Request("https://fleet.example.com", { headers: { cookie: "fleethub_session_old=bad; fleethub_session=valid" } });
    expect(getCookie(req, "fleethub_session")).toBe("valid");
    expect(getCookie(req, "other")).toBeNull();
  });

  it("rejects malformed password hashes before expensive derivation", async () => {
    const password = "example-password";
    const valid = await hashPassword(password);
    expect(await verifyPassword(password, valid)).toBe(true);
    expect(await verifyPassword("incorrect", valid)).toBe(false);
    expect(await verifyPassword(password, "broken")).toBe(false);
    const [salt, , digest] = valid.split(":");
    expect(await verifyPassword(password, `${salt}:1:${digest}`)).toBe(false);
    expect(await verifyPassword(password, `${salt}:1000000.5:${digest}`)).toBe(false);
    expect(await verifyPassword(password, `${salt}:100000:${digest}:extra`)).toBe(false);
  });
});

describe("Google OAuth browser binding", () => {
  function mockGoogle() {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("oauth2.googleapis.com/token")) {
        expect(String(init?.body)).toContain("code_verifier=");
        return Response.json({ access_token: "access-token" });
      }
      return Response.json({ sub: "google-sub-1", email: "operator@example.com", email_verified: true, name: "Operator" });
    });
  }

  it("requires matching signed cookie and state, then consumes state once", async () => {
    mockGoogle();
    const begin = await beginGoogle(new Request("http://internal:3000/api/auth/google", { headers: { accept: "application/json" } }));
    expect(begin.status).toBe(200);
    const oauthCookie = begin.headers.get("set-cookie") || "";
    expect(oauthCookie).toContain("HttpOnly");
    expect(oauthCookie).toContain("Secure");
    const cookie = oauthCookie.split(";")[0];
    const { url } = await begin.json();
    const oauthUrl = new URL(url);
    const state = oauthUrl.searchParams.get("state");
    expect(state).toBeTruthy();
    expect(oauthUrl.searchParams.get("code_challenge_method")).toBe("S256");

    const callbackUrl = `https://fleet.example.com/api/auth/callback/google?code=good&state=${state}`;
    const noCookie = await finishGoogle(new Request(callbackUrl));
    expect(noCookie.headers.get("location")).toContain("invalid_state");
    const wrongState = await finishGoogle(new Request(`${callbackUrl}wrong`, { headers: { cookie } }));
    expect(wrongState.headers.get("location")).toContain("invalid_state");
    expect(global.fetch).not.toHaveBeenCalled();

    const success = await finishGoogle(new Request(callbackUrl, { headers: { cookie } }));
    expect(success.headers.get("location")).toContain("auth_success=google");
    expect(success.headers.get("set-cookie")).toContain("fleethub_session=");
    const replay = await finishGoogle(new Request(callbackUrl, { headers: { cookie } }));
    expect(replay.headers.get("location")).toContain("invalid_state");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects unverified Google email before creating a session", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => String(input).includes("oauth2.googleapis.com/token")
      ? Response.json({ access_token: "access-token" })
      : Response.json({ sub: "google-sub-1", email: "operator@example.com", email_verified: false }));
    const begin = await beginGoogle(new Request("https://fleet.example.com/api/auth/google", { headers: { accept: "application/json" } }));
    const cookie = (begin.headers.get("set-cookie") || "").split(";")[0];
    const { url } = await begin.json();
    const state = new URL(url).searchParams.get("state");
    const callback = await finishGoogle(new Request(`https://fleet.example.com/api/auth/callback/google?code=good&state=${state}`, { headers: { cookie } }));
    expect(callback.headers.get("location")).toContain("google_exchange_failed");
    expect(database.users.size).toBe(0);
  });

  it("denies first-time Google access without an allowlist", async () => {
    mockGoogle();
    delete process.env.FLEETHUB_ALLOWED_EMAILS;
    const begin = await beginGoogle(new Request("https://fleet.example.com/api/auth/google", { headers: { accept: "application/json" } }));
    const cookie = (begin.headers.get("set-cookie") || "").split(";")[0];
    const { url } = await begin.json();
    const state = new URL(url).searchParams.get("state");
    const result = await finishGoogle(new Request(`https://fleet.example.com/api/auth/callback/google?code=good&state=${state}`, { headers: { cookie } }));
    expect(result.headers.get("location")).toContain("unauthorized_email");
    expect(database.users.size).toBe(0);
  });

  it("fails closed when Google user persistence fails", async () => {
    mockGoogle();
    database.failUserWrite = true;
    const begin = await beginGoogle(new Request("https://fleet.example.com/api/auth/google", { headers: { accept: "application/json" } }));
    const cookie = (begin.headers.get("set-cookie") || "").split(";")[0];
    const { url } = await begin.json();
    const state = new URL(url).searchParams.get("state");
    const result = await finishGoogle(new Request(`https://fleet.example.com/api/auth/callback/google?code=good&state=${state}`, { headers: { cookie } }));
    expect(result.headers.get("location")).toContain("persistence_unavailable");
    expect(result.headers.get("set-cookie")).not.toContain("fleethub_session=");
  });

  it("uses the persisted user ID on repeat Google sign-in", async () => {
    mockGoogle();
    async function signIn(): Promise<string> {
      const begin = await beginGoogle(new Request("https://fleet.example.com/api/auth/google", { headers: { accept: "application/json" } }));
      const cookie = (begin.headers.get("set-cookie") || "").split(";")[0];
      const { url } = await begin.json();
      const state = new URL(url).searchParams.get("state");
      const result = await finishGoogle(new Request(`https://fleet.example.com/api/auth/callback/google?code=good&state=${state}`, { headers: { cookie } }));
      const sessionToken = /fleethub_session=([^;]+)/.exec(result.headers.get("set-cookie") || "")?.[1];
      expect(sessionToken).toBeTruthy();
      const id = verifySessionToken(sessionToken || "")?.id;
      expect(id).toBeTruthy();
      return id || "";
    }
    const first = await signIn();
    expect(await signIn()).toBe(first);
    expect(database.users.size).toBe(1);
  });

  it("rejects tampered, expired, and future OAuth browser cookies", async () => {
    const begin = await beginGoogle(new Request("https://fleet.example.com/api/auth/google", { headers: { accept: "application/json" } }));
    const cookie = (begin.headers.get("set-cookie") || "").split(";")[0];
    const { url } = await begin.json();
    const state = new URL(url).searchParams.get("state");
    expect(state).toBeTruthy();
    const request = (value: string) => new Request("https://fleet.example.com/api/auth/callback/google", { headers: { cookie: `fleethub_google_oauth=${value}` } });
    const signed = cookie.split("=")[1];
    expect(await consumeGoogleOAuthFlow(request(`${signed}x`), state)).toBeNull();
    for (const issuedAt of [Date.now() - 11 * 60000, Date.now() + 2 * 60000]) {
      const payload = Buffer.from(JSON.stringify({ state, issuedAt })).toString("base64url");
      const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
      expect(await consumeGoogleOAuthFlow(request(`${payload}.${signature}`), state)).toBeNull();
    }
    expect(await consumeGoogleOAuthFlow(request(signed), state)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("fails closed if consuming OAuth state loses database access", async () => {
    const begin = await beginGoogle(new Request("https://fleet.example.com/api/auth/google", { headers: { accept: "application/json" } }));
    const cookie = (begin.headers.get("set-cookie") || "").split(";")[0];
    const { url } = await begin.json();
    const state = new URL(url).searchParams.get("state");
    database.failOAuthConsume = true;
    const request = new Request("https://fleet.example.com/api/auth/callback/google", { headers: { cookie } });
    expect(await consumeGoogleOAuthFlow(request, state)).toBeNull();
  });

  it("fails closed on malformed Google token and userinfo responses", async () => {
    const verifier = "a".repeat(43);
    global.fetch = vi.fn(async () => Response.json({ access_token: "" }));
    expect(await exchangeGoogleCodeForUser("code", "https://fleet.example.com", verifier)).toBeNull();
    global.fetch = vi.fn(async () => new Response(null, { status: 502 }));
    expect(await exchangeGoogleCodeForUser("code", "https://fleet.example.com", verifier)).toBeNull();
    global.fetch = vi.fn(async (input: RequestInfo | URL) => String(input).includes("oauth2.googleapis.com/token")
      ? Response.json({ access_token: "access-token" })
      : Response.json({ email: "operator@example.com", email_verified: true }));
    expect(await exchangeGoogleCodeForUser("code", "https://fleet.example.com", verifier)).toBeNull();
    global.fetch = vi.fn(async () => { throw new Error("network unavailable"); });
    expect(await exchangeGoogleCodeForUser("code", "https://fleet.example.com", verifier)).toBeNull();
    expect(await exchangeGoogleCodeForUser("code", "https://fleet.example.com", "bad")).toBeNull();
  });
});


describe("OAuth route failure responses", () => {
 const request = () => new Request("https://fleet.example.com/api/auth/google");
 it("rejects throttled and unavailable limiter requests on both public endpoints", async () => {
  database.limiter = "deny";
  expect((await beginGoogle(request())).status).toBe(429);
  expect((await finishGoogle(request())).status).toBe(429);
  database.limiter = "fail";
  expect((await beginGoogle(request())).status).toBe(503);
  expect((await finishGoogle(request())).status).toBe(503);
 });
 it("rejects disabled OAuth and invalid canonical origin without session issuance", async () => {
  process.env.FLEETHUB_GOOGLE_AUTH_ENABLED = "false";
  expect((await beginGoogle(request())).status).toBe(503);
  expect((await finishGoogle(request())).headers.get("location")).toContain("google_disabled");
  process.env.FLEETHUB_APP_URL = "javascript:invalid";
  expect((await finishGoogle(request())).status).toBe(503);
 });
 it("fails start closed when schema initialization is unavailable", async () => {
  database.bootstrapSuccess = false;
  const result = await beginGoogle(request());
  expect(result.status).toBe(503);
  expect(result.headers.has("set-cookie")).toBe(false);
 });
 it("handles denial, missing authorization code, and persistence failure after valid state", async () => {
  for (const mode of ["denied", "missing", "database"]) {
   const begin = await beginGoogle(new Request(request().url, { headers: { accept: "application/json" } }));
   const { url } = await begin.json();
   const state = new URL(url).searchParams.get("state");
   const cookie = (begin.headers.get("set-cookie") || "").split(";")[0];
   const suffix = mode === "denied" ? "&error=access_denied" : mode === "database" ? "&code=good" : "";
   if (mode === "database") {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => String(input).includes("oauth2.googleapis.com/token")
      ? Response.json({ access_token: "test-access-token" })
      : Response.json({ sub: "test-sub", email: "operator@example.com", email_verified: true }));
    database.bootstrapSuccess = false;
   }
   const result = await finishGoogle(new Request(`https://fleet.example.com/api/auth/callback/google?state=${state}${suffix}`, { headers: { cookie } }));
   expect(result.headers.get("location")).toContain(mode === "denied" ? "access_denied" : mode === "missing" ? "no_code" : "persistence_unavailable");
   expect(result.headers.get("set-cookie")).not.toContain("fleethub_session=");
  }
 });
});
