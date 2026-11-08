import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { verifyApiAccess, readJsonWithLimit } from "../src/lib/auth/guard";
import { middleware } from "../src/proxy";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/sessions", async importOriginal => (await import("./helpers/session-store-mock")).sessionStoreMock(await importOriginal<typeof import("../src/lib/auth/sessions")>()));
vi.mock("../src/lib/auth/rate-limit", () => ({ consumeSharedLimit: vi.fn(async () => ({ allowed: true })) }));

describe("API Security, Authentication & Rate Limiting Guard", async () => {
  const origApiKey = process.env.FLEETHUB_API_KEY;
  const origReadOnlyKey = process.env.FLEETHUB_READONLY_KEY;
  const origNodeEnv = process.env.NODE_ENV;
  const origAuthSecret = process.env.FLEETHUB_AUTH_SECRET;
  const origAuthRequired = process.env.FLEETHUB_AUTH_REQUIRED;

  beforeEach(() => {
    delete process.env.FLEETHUB_API_KEY;
    delete process.env.FLEETHUB_READONLY_KEY;
    (process.env as any).NODE_ENV = "development";
    process.env.FLEETHUB_AUTH_SECRET = "test-auth-secret-at-least-thirty-two-characters";
    delete process.env.FLEETHUB_AUTH_REQUIRED;
  });

  afterEach(() => {
    if (origApiKey) {
      process.env.FLEETHUB_API_KEY = origApiKey;
    } else {
      delete process.env.FLEETHUB_API_KEY;
    }
    if (origReadOnlyKey) {
      process.env.FLEETHUB_READONLY_KEY = origReadOnlyKey;
    } else {
      delete process.env.FLEETHUB_READONLY_KEY;
    }
    (process.env as any).NODE_ENV = origNodeEnv;
    if (origAuthSecret) process.env.FLEETHUB_AUTH_SECRET = origAuthSecret;
    else delete process.env.FLEETHUB_AUTH_SECRET;
    if (origAuthRequired) process.env.FLEETHUB_AUTH_REQUIRED = origAuthRequired;
    else delete process.env.FLEETHUB_AUTH_REQUIRED;
  });

  it("permits local read requests when no API key is configured in dev", async () => {
    const req = new Request("http://localhost:3000/api/fleet", {
      method: "GET",
      headers: { "x-real-ip": "127.0.0.1" },
    });

    const result = await verifyApiAccess(req);
    expect(result.authorized).toBe(true);
    expect(result.status).toBe(200);
  });

  it("enforces authentication when FLEETHUB_API_KEY is configured", async () => {
    process.env.FLEETHUB_API_KEY = "super-secret-key-12345";

    const unauthReq = new Request("http://localhost:3000/api/fleet", {
      method: "GET",
    });
    const unauthResult = await verifyApiAccess(unauthReq);
    expect(unauthResult.authorized).toBe(false);
    expect(unauthResult.status).toBe(401);

    // With wrong key
    const badKeyReq = new Request("http://localhost:3000/api/fleet", {
      method: "GET",
      headers: { authorization: "Bearer wrong-key" },
    });
    const badKeyResult = await verifyApiAccess(badKeyReq);
    expect(badKeyResult.authorized).toBe(false);
    expect(badKeyResult.status).toBe(401);

    // With correct Bearer token
    const validBearerReq = new Request("http://localhost:3000/api/fleet", {
      method: "GET",
      headers: { authorization: "Bearer super-secret-key-12345" },
    });
    const validResult = await verifyApiAccess(validBearerReq);
    expect(validResult.authorized).toBe(true);
    expect(validResult.status).toBe(200);

    // With correct x-api-key header
    const validHeaderReq = new Request("http://localhost:3000/api/fleet", {
      method: "GET",
      headers: { "x-api-key": "super-secret-key-12345" },
    });
    expect((await verifyApiAccess(validHeaderReq)).authorized).toBe(true);
  });

  it("strictly fails closed in production for ALL requests (reads AND writes) when unauthenticated", async () => {
    (process.env as any).NODE_ENV = "production";
    delete process.env.FLEETHUB_API_KEY;

    // 1. GET requests must be rejected
    const getReq = new Request("http://hub.example.com/api/fleet", {
      method: "GET",
    });
    const getResult = await verifyApiAccess(getReq);
    expect(getResult.authorized).toBe(false);
    expect(getResult.status).toBe(401);
    expect(getResult.reason).toContain("FLEETHUB_API_KEY must be configured in production");

    // 2. POST requests must be rejected
    const postReq = new Request("http://hub.example.com/api/infisical", {
      method: "POST",
      body: JSON.stringify({ action: "sync" }),
    });
    const postResult = await verifyApiAccess(postReq, { requireWrite: true });
    expect(postResult.authorized).toBe(false);
    expect(postResult.status).toBe(401);
  });

  it("middleware strictly rejects unauthenticated production requests", async () => {
    (process.env as any).NODE_ENV = "production";
    delete process.env.FLEETHUB_API_KEY;

    const nextReq = new NextRequest("http://hub.example.com/api/mcp", {
      method: "GET",
    });

    const res = await middleware(nextReq);
    expect(res.status).toBe(401);
  });

  it("middleware permits authenticated production requests", async () => {
    (process.env as any).NODE_ENV = "production";
    process.env.FLEETHUB_API_KEY = "prod-secret-token";

    const nextReq = new NextRequest("http://hub.example.com/api/mcp", {
      method: "GET",
      headers: { authorization: "Bearer prod-secret-token" },
    });

    const res = await middleware(nextReq);
    expect(res.status).toBe(200);
  });

  it("rejects streaming payload larger than 64 KB even without Content-Length header", async () => {
    // Generate a payload stream of 70 KB
    const largeChunk = new Uint8Array(70 * 1024);
    largeChunk.fill(65); // 'A'

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(largeChunk);
        controller.close();
      },
    });

    const req = new Request("http://localhost:3000/api/infisical", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as any);

    const result = await readJsonWithLimit(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(413);
      expect(result.error).toContain("Payload too large");
    }
  });

  it("enforces rate limits on excessive requests", async () => {
    process.env.FLEETHUB_API_KEY = "rate-limit-test-key";
    const testIp = "192.168.1.99";
    let lastResult = { authorized: true, status: 200 };

    for (let i = 0; i < 25; i++) {
      const req = new Request("http://localhost:3000/api/infisical", {
        method: "POST",
        headers: {
          "x-real-ip": testIp,
          "x-api-key": "rate-limit-test-key",
        },
      });
      lastResult = await verifyApiAccess(req, { requireWrite: true });
      if (!lastResult.authorized) break;
    }

    expect(lastResult.authorized).toBe(false);
    expect(lastResult.status).toBe(429);
  });

  it("handles FLEETHUB_READONLY_KEY by permitting GET reads and rejecting POST writes with 403 Forbidden", async () => {
    process.env.FLEETHUB_READONLY_KEY = "reader-scoped-token-xyz";

    // 1. GET read with read-only token must succeed
    const getReq = new Request("http://localhost:3000/api/fleet", {
      method: "GET",
      headers: { authorization: "Bearer reader-scoped-token-xyz" },
    });
    const getResult = await verifyApiAccess(getReq);
    expect(getResult.authorized).toBe(true);
    expect(getResult.status).toBe(200);

    // 2. POST write with read-only token must be rejected with 403 Forbidden
    const postReq = new Request("http://localhost:3000/api/infisical", {
      method: "POST",
      headers: { authorization: "Bearer reader-scoped-token-xyz" },
    });
    const postResult = await verifyApiAccess(postReq, { requireWrite: true });
    expect(postResult.authorized).toBe(false);
    expect(postResult.status).toBe(403);
    expect(postResult.reason).toContain("Scoped read-only API key cannot perform mutations");
  });

  it("strictly fails closed if req object is null or undefined", async () => {
    const nullResult = await verifyApiAccess(null as any);
    expect(nullResult.authorized).toBe(false);
    expect(nullResult.status).toBe(401);
    expect(nullResult.reason).toContain("Valid Request object is required");
  });

  it("aborts body stream and returns 408 Request Timeout when slow-read deadline is exceeded", async () => {
    // Stream that hangs and does not complete
    const hangingStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        // intentionally not closing or enqueuing further to trigger timeout
      },
    });

    const slowReq = new Request("http://localhost:3000/api/infisical", {
      method: "POST",
      body: hangingStream,
      duplex: "half",
    } as any);

    // Call with a small 100ms timeout for test speed
    const result = await readJsonWithLimit(slowReq, 64 * 1024, 100);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(408);
      expect(result.error).toContain("slow-read deadline");
    }
  });

  it("hashes and verifies passwords securely using PBKDF2-SHA512", async () => {
    const { hashPassword, verifyPassword } = await import("../src/lib/auth/session");
    const password = "mySecretPassword123!";
    const hash = await hashPassword(password);
    expect(hash).toContain(":");
    expect(await verifyPassword(password, hash)).toBe(true);
    expect(await verifyPassword("wrongPassword", hash)).toBe(false);
    expect(await verifyPassword(password, "invalid:hash")).toBe(false);
  });

  it("creates and verifies signed tamper-proof session tokens", async () => {
    const { createSessionToken, verifySessionToken, createSessionCookie, createClearSessionCookie } = await import("../src/lib/auth/session");
    const user = {
      id: "u123",
      email: "admin@fleethub.internal",
      name: "Admin User",
      provider: "local" as const,
      createdAt: Date.now(),
    };
    const token = createSessionToken(user);
    expect(token).toContain(".");
    const decoded = verifySessionToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.email).toBe(user.email);

    // A token stops working at the same instant as its database row (expires_at > NOW()).
    const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;
    const issued = Date.now();
    const timed = createSessionToken({ ...user, createdAt: issued });
    vi.spyOn(Date, "now").mockReturnValue(issued + SESSION_MAX_AGE_SEC * 1000 - 1);
    expect(verifySessionToken(timed)).not.toBeNull();
    vi.spyOn(Date, "now").mockReturnValue(issued + SESSION_MAX_AGE_SEC * 1000);
    expect(verifySessionToken(timed)).toBeNull();
    vi.restoreAllMocks();

    // Tampered token fails
    const tampered = token.replace("a", "b");
    expect(verifySessionToken(tampered)).toBeNull();

    // Cookie helpers
    const cookie = createSessionCookie(token, true);
    expect(cookie).toContain("fleethub_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");

    const clearCookie = createClearSessionCookie();
    expect(clearCookie).toContain("Max-Age=0");
  });

  it("extracts session from oauth2-proxy headers when FLEETHUB_TRUST_PROXY_AUTH is enabled", async () => {
    const { getSessionFromRequest } = await import("../src/lib/auth/session");
    const originalAllowedEmails = process.env.FLEETHUB_ALLOWED_EMAILS;
    const originalProxySecret = process.env.FLEETHUB_PROXY_AUTH_SECRET;
    process.env.FLEETHUB_TRUST_PROXY_AUTH = "true";
    process.env.FLEETHUB_ALLOWED_EMAILS = "owner@example.com";
    process.env.FLEETHUB_PROXY_AUTH_SECRET = "proxy-secret-at-least-thirty-two-characters";

    const proxyReq = new Request("http://localhost:3000/api/fleet", {
      headers: {
        "x-auth-request-email": "owner@example.com",
        "x-auth-request-user": "jamie",
        "x-fleethub-proxy-secret": "proxy-secret-at-least-thirty-two-characters",
      },
    });

    const user = getSessionFromRequest(proxyReq);
    expect(user).not.toBeNull();
    expect(user?.email).toBe("owner@example.com");
    expect(user?.name).toBe("jamie");
    expect(user?.provider).toBe("google");

    delete process.env.FLEETHUB_TRUST_PROXY_AUTH;
    if (originalAllowedEmails) process.env.FLEETHUB_ALLOWED_EMAILS = originalAllowedEmails;
    else delete process.env.FLEETHUB_ALLOWED_EMAILS;
    if (originalProxySecret) process.env.FLEETHUB_PROXY_AUTH_SECRET = originalProxySecret;
    else delete process.env.FLEETHUB_PROXY_AUTH_SECRET;
  });

  it("generates correct Google OAuth URL and respects toggle", async () => {
    const { isGoogleAuthEnabled, getGoogleOAuthUrl } = await import("../src/lib/auth/session");

    // Disabled without keys
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(isGoogleAuthEnabled()).toBe(false);

    // Enabled with keys
    process.env.GOOGLE_CLIENT_ID = "mock-client-id.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "mock-client-secret";
    expect(isGoogleAuthEnabled()).toBe(true);

    const url = getGoogleOAuthUrl("http://localhost:3060");
    expect(url).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(url).toContain("mock-client-id");
    expect(url).toContain("http%3A%2F%2Flocalhost%3A3060%2Fapi%2Fauth%2Fcallback%2Fgoogle");

    // Disabled explicitly
    process.env.FLEETHUB_GOOGLE_AUTH_ENABLED = "false";
    expect(isGoogleAuthEnabled()).toBe(false);

    delete process.env.FLEETHUB_GOOGLE_AUTH_ENABLED;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it("handles Google OAuth code exchange successfully and on error", async () => {
    const { exchangeGoogleCodeForUser } = await import("../src/lib/auth/session");
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";

    const origFetch = global.fetch;

    // 1. Successful exchange
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("oauth2.googleapis.com/token")) {
        return {
          ok: true,
          json: async () => ({ access_token: "mock-google-token" }),
        } as any;
      }
      if (url.includes("openidconnect.googleapis.com/v1/userinfo")) {
        return {
          ok: true,
          json: async () => ({ sub: "google-sub", email: "dev@example.com", email_verified: true, name: "Dev User" }),
        } as any;
      }
      return { ok: false, text: async () => "Not found" } as any;
    });

    const verifier = "v".repeat(43);
    const user = await exchangeGoogleCodeForUser("valid-code", "http://localhost:3060", verifier);
    expect(user).not.toBeNull();
    expect(user?.email).toBe("dev@example.com");
    expect(user?.name).toBe("Dev User");

    // 2. Token error
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => "invalid_grant",
    } as any);

    const failUser = await exchangeGoogleCodeForUser("bad-code", "http://localhost:3060", verifier);
    expect(failUser).toBeNull();

    // 3. Network throw
    global.fetch = vi.fn().mockRejectedValue(new Error("Network failed"));
    const errUser = await exchangeGoogleCodeForUser("err-code", "http://localhost:3060", verifier);
    expect(errUser).toBeNull();

    global.fetch = origFetch;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it("verifies session expiry and rejects expired sessions", async () => {
    const { createSessionToken, verifySessionToken } = await import("../src/lib/auth/session");
    const expiredUser = {
      id: "u123",
      email: "old@example.com",
      name: "Old User",
      provider: "local" as const,
      createdAt: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 days ago
    };

    const token = createSessionToken(expiredUser);
    expect(verifySessionToken(token)).toBeNull();
  });

  it("authorizes verifyApiAccess when a valid session cookie is present", async () => {
    const { createSessionToken } = await import("../src/lib/auth/session");
    const user = {
      id: "u456",
      email: "operator@fleethub.internal",
      name: "Fleet Operator",
      provider: "google" as const,
      createdAt: Date.now(),
    };
    const token = createSessionToken(user);

    const req = new Request("http://localhost:3000/api/fleet", {
      headers: {
        cookie: `fleethub_session=${token}`,
      },
    });

    const result = await verifyApiAccess(req);
    expect(result.authorized).toBe(true);
    expect(result.status).toBe(200);
    expect(result.user?.email).toBe(user.email);
  });

  it("strictly enforces FLEETHUB_AUTH_REQUIRED when no session or token is present", async () => {
    process.env.FLEETHUB_AUTH_REQUIRED = "true";

    const unauthReq = new Request("http://localhost:3000/api/fleet", {
      method: "GET",
    });

    const result = await verifyApiAccess(unauthReq);
    expect(result.authorized).toBe(false);
    expect(result.status).toBe(401);
    expect(result.reason).toContain("Sign in with Email/Password or Google OAuth");

    delete process.env.FLEETHUB_AUTH_REQUIRED;
  });

  it("rejects an invalid supplied token even when local mode permits anonymous reads", async () => {
    process.env.FLEETHUB_AUTH_REQUIRED = "true";
    for (const [header, value] of [["authorization", "Bearer wrong-token"], ["x-api-key", "wrong-token"], ["authorization", "Basic abc"]]) {
      const result = await verifyApiAccess(new Request("http://localhost:3000/api/fleet", { headers: { [header]: value } }));
      expect(result).toMatchObject({ authorized: false, status: 401 });
    }
    const { createSessionToken } = await import("../src/lib/auth/session");
    const token = createSessionToken({ id: "u1", email: "owner@example.com", name: "Owner", provider: "local", createdAt: Date.now() });
    const withCookie = await verifyApiAccess(new Request("http://localhost:3000/api/fleet", {
      headers: { cookie: `fleethub_session=${token}`, authorization: "Bearer wrong-token" },
    }));
    expect(withCookie).toMatchObject({ authorized: false, status: 401 });
  });

  it("allows only the exact public auth endpoints through required-mode proxy", async () => {
    process.env.FLEETHUB_AUTH_REQUIRED = "true";
    for (const path of ["/api/auth", "/api/auth/google", "/api/auth/callback/google"]) {
      const response = await middleware(new NextRequest(`http://localhost:3000${path}`));
      expect(response.status).toBe(200);
    }
    for (const path of ["/api/auth/private", "/api/authentic", "/api/fleet"]) {
      const response = await middleware(new NextRequest(`http://localhost:3000${path}`));
      expect(response.status).toBe(401);
    }
  });

  it("identifies client by trusted IP header when configured", async () => {
    process.env.FLEETHUB_TRUSTED_IP_HEADER = "cf-connecting-ip";

    const req = new Request("http://localhost:3000/api/fleet", {
      method: "GET",
      headers: { "cf-connecting-ip": "203.0.113.195" },
    });

    const result = await verifyApiAccess(req);
    expect(result.authorized).toBe(true);

    delete process.env.FLEETHUB_TRUSTED_IP_HEADER;
  });
});


describe("session mutation origin checks", () => {
 afterEach(() => vi.unstubAllEnvs());
 it("requires the canonical browser origin for every session-authenticated write", async () => {
  const { createSessionToken } = await import("../src/lib/auth/session");
  vi.stubEnv("FLEETHUB_AUTH_SECRET", "session-origin-test-secret-at-least-32-bytes");
  vi.stubEnv("FLEETHUB_APP_URL", "https://fleet.example");
  const token = createSessionToken({ id: "operator", email: "test@example.com", name: "Operator", provider: "local", createdAt: Date.now() });
  const req = (origin?: string) => new Request("https://fleet.example/api/providers", {
   method: "POST", headers: { cookie: `fleethub_session=${token}`, ...(origin ? { origin } : {}) },
  });
  expect((await verifyApiAccess(req(), { skipRateLimit: true })).status).toBe(403);
  expect((await verifyApiAccess(req("https://evil.example"), { skipRateLimit: true })).status).toBe(403);
  expect((await verifyApiAccess(req("https://fleet.example"), { skipRateLimit: true })).authorized).toBe(true);
  vi.stubEnv("FLEETHUB_APP_URL", "invalid");
  expect((await verifyApiAccess(req("https://fleet.example"), { skipRateLimit: true })).status).toBe(403);
 });
});
