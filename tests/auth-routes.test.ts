import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  users: [] as Array<{ id: string; email: string; password_hash: string; name: string; auth_provider: string }>,
  statements: [] as string[],
  fail: false,
  bootstrapSuccess: true,
  bootstrapThrows: false,
  limit: "allow" as "allow" | "deny" | "fail",
}));

vi.mock("@/lib/auth/sessions", async importOriginal => (await import("./helpers/session-store-mock")).sessionStoreMock(await importOriginal<typeof import("../src/lib/auth/sessions")>()));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: vi.fn(async () => {
  if (database.bootstrapThrows) throw new Error("private bootstrap diagnostic");
  return { success: database.bootstrapSuccess };
}) }));
vi.mock("@/lib/auth/guard", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/auth/guard")>();
  return { ...original, checkAuthRateLimit: vi.fn(async () => {
    if (database.limit === "fail") throw new Error("private limiter diagnostic");
    return database.limit === "allow";
  }) };
});
vi.mock("@/lib/db/client", () => {
  async function execute(strings: TemplateStringsArray, ...values: unknown[]) {
    const sql = strings.join("?").trim();
    database.statements.push(sql);
    if (database.fail) throw new Error("private database connection string");
    if (sql.startsWith("LOCK TABLE")) return [];
    if (sql.startsWith("SELECT EXISTS")) return [{ present: database.users.length > 0 }];
    if (sql.startsWith("SELECT NOT EXISTS")) return [{ available: database.users.length === 0 }];
    if (sql.startsWith("INSERT INTO app_users")) {
      database.users.push({ id: String(values[0]), email: String(values[1]), password_hash: String(values[2]), name: String(values[3]), auth_provider: "local" });
      return [];
    }
    if (sql.startsWith("SELECT id, email")) return database.users.filter((user) => user.email === values[0]).slice(0, 1);
    throw new Error(`Unexpected SQL: ${sql}`);
  }
  return { queryClient: Object.assign(execute, { begin: async (callback: (transaction: typeof execute) => Promise<unknown>) => callback(execute) }) };
});

import { GET, POST } from "../src/app/api/auth/route";
import { createSessionToken, hashPassword } from "../src/lib/auth/session";

const origin = "http://localhost:3060";
const bootstrapToken = "bootstrap-token-at-least-thirty-two-chars";
const authSecret = "auth-secret-at-least-thirty-two-characters";

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(new Request(`${origin}/api/auth`, {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }));
}

const original = {
  bootstrap: process.env.FLEETHUB_BOOTSTRAP_TOKEN,
  secret: process.env.FLEETHUB_AUTH_SECRET,
  adminEmail: process.env.FLEETHUB_ADMIN_EMAIL,
  adminPassword: process.env.FLEETHUB_ADMIN_PASSWORD,
  appUrl: process.env.FLEETHUB_APP_URL,
};

beforeEach(() => {
  database.users.length = 0;
  database.statements.length = 0;
  database.fail = false;
  database.bootstrapSuccess = true;
  database.bootstrapThrows = false;
  database.limit = "allow";
  process.env.FLEETHUB_BOOTSTRAP_TOKEN = bootstrapToken;
  process.env.FLEETHUB_AUTH_SECRET = authSecret;
  delete process.env.FLEETHUB_APP_URL;
  delete process.env.FLEETHUB_ADMIN_EMAIL;
  delete process.env.FLEETHUB_ADMIN_PASSWORD;
});
afterEach(() => {
  for (const [key, value] of Object.entries({
    FLEETHUB_BOOTSTRAP_TOKEN: original.bootstrap,
    FLEETHUB_AUTH_SECRET: original.secret,
    FLEETHUB_ADMIN_EMAIL: original.adminEmail,
    FLEETHUB_ADMIN_PASSWORD: original.adminPassword,
    FLEETHUB_APP_URL: original.appUrl,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("auth route", () => {
  it("requires same-origin mutations before reading a password", async () => {
    const response = await post({ action: "register", email: "a@example.com", password: "strong-password", bootstrapToken }, { origin: "https://evil.example" });
    expect(response.status).toBe(403);
    const crossSite = await post({ action: "logout" }, { "sec-fetch-site": "cross-site" });
    expect(crossSite.status).toBe(403);
    expect(database.statements).toEqual([]);
  });

  it("fails closed when the canonical origin is invalid", async () => {
    process.env.FLEETHUB_APP_URL = "javascript:unsafe";
    expect((await post({ action: "logout" })).status).toBe(403);
    const status = await GET(new Request(`${origin}/api/auth`));
    expect((await status.json()).googleRedirectUri).toBeNull();
  });

  it("returns safe errors for unavailable or exhausted auth rate limits", async () => {
    database.limit = "deny";
    expect((await GET(new Request(`${origin}/api/auth`))).status).toBe(429);
    expect((await post({ action: "logout" })).status).toBe(429);
    database.limit = "fail";
    const read = await GET(new Request(`${origin}/api/auth`));
    const write = await post({ action: "logout" });
    expect(read.status).toBe(503);
    expect(write.status).toBe(503);
    expect(await write.text()).not.toContain("private limiter diagnostic");
  });

  it("rejects malformed JSON and invalid credentials before database access", async () => {
    const malformed = await POST(new Request(`${origin}/api/auth`, { method: "POST", headers: { origin }, body: "{" }));
    expect(malformed.status).toBe(400);
    for (const body of [
      { action: "login", email: "invalid", password: "a" },
      { action: "login", email: "owner@example.com", password: 123 },
      { action: "register", email: "owner@example.com", password: "short", bootstrapToken },
      { action: "unexpected" },
    ]) expect((await post(body)).status).toBe(400);
    expect(database.statements).toEqual([]);
  });

  it("requires the configured bootstrap token before any database work", async () => {
    const response = await post({ action: "register", email: "a@example.com", password: "strong-password", bootstrapToken: "wrong" });
    expect(response.status).toBe(403);
    expect(database.statements).toEqual([]);
  });

  it("requires a strong session secret before creating an operator", async () => {
    delete process.env.FLEETHUB_AUTH_SECRET;
    const response = await post({ action: "register", email: "a@example.com", password: "strong-password", bootstrapToken });
    expect(response.status).toBe(403);
    expect(database.statements).toEqual([]);
  });

  it("does not offer registration with a short token, missing secret, or unavailable database", async () => {
    process.env.FLEETHUB_BOOTSTRAP_TOKEN = "short";
    expect((await (await GET(new Request(`${origin}/api/auth`))).json()).registrationAvailable).toBe(false);
    expect((await post({ action: "register", email: "owner@example.com", password: "strong-password", bootstrapToken: "short" })).status).toBe(403);
    process.env.FLEETHUB_BOOTSTRAP_TOKEN = bootstrapToken;
    database.bootstrapSuccess = false;
    expect((await (await GET(new Request(`${origin}/api/auth`))).json()).registrationAvailable).toBe(false);
    expect((await post({ action: "register", email: "owner@example.com", password: "strong-password", bootstrapToken })).status).toBe(503);
    database.bootstrapSuccess = true;
    database.bootstrapThrows = true;
    expect((await (await GET(new Request(`${origin}/api/auth`))).json()).registrationAvailable).toBe(false);
    expect((await post({ action: "register", email: "owner@example.com", password: "strong-password", bootstrapToken })).status).toBe(500);
  });

  it("creates the first operator under a table lock and rejects all later registration without overwriting", async () => {
    const body = { action: "register", email: "a@example.com", name: "Owner", password: "strong-password", bootstrapToken };
    const first = await post(body);
    expect(first.status).toBe(200);
    expect(first.headers.get("set-cookie")).toContain("HttpOnly");
    expect(database.statements.slice(0, 3)).toEqual(expect.arrayContaining([
      expect.stringContaining("LOCK TABLE app_users"),
      expect.stringContaining("SELECT EXISTS"),
      expect.stringContaining("INSERT INTO app_users"),
    ]));
    const storedHash = database.users[0].password_hash;
    const second = await post({ ...body, password: "changed-password" });
    expect(second.status).toBe(403);
    expect(database.users).toHaveLength(1);
    expect(database.users[0].password_hash).toBe(storedHash);
  });

  it("normalizes the first email, derives a missing name, and sets Secure on the canonical HTTPS cookie", async () => {
    process.env.FLEETHUB_APP_URL = "https://fleet.example.com";
    const response = await post({ action: "register", email: " OWNER@EXAMPLE.COM ", password: "strong-password", bootstrapToken }, { origin: "https://fleet.example.com" });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("; Secure");
    expect(database.users[0]).toMatchObject({ email: "owner@example.com", name: "owner" });
    const logout = await post({ action: "logout" }, { origin: "https://fleet.example.com" });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0; Secure");
  });

  it("redacts a failed registration write without creating a session", async () => {
    database.fail = true;
    const response = await post({ action: "register", email: "owner@example.com", password: "strong-password", bootstrapToken });
    expect(response.status).toBe(500);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).not.toContain("private database connection string");
  });

  it("logs in a stored local operator with a verified password", async () => {
    database.users.push({ id: "owner-id", email: "owner@example.com", password_hash: await hashPassword("strong-password"), name: "Owner", auth_provider: "local" });
    process.env.FLEETHUB_AUTH_REQUIRED = "true";
    const response = await post({ action: "login", email: " OWNER@EXAMPLE.COM ", password: "strong-password" });
    expect(response.status).toBe(200);
    expect((await response.json()).user.id).toBe("owner-id");
    expect(response.headers.get("set-cookie")).toContain("fleethub_session=");
  });

  it("reports a valid session and canonical Google redirect URI", async () => {
    const token = createSessionToken({ id: "owner-id", email: "owner@example.com", name: "Owner", provider: "local", createdAt: Date.now() });
    process.env.FLEETHUB_AUTH_REQUIRED = "true";
    process.env.FLEETHUB_APP_URL = "https://fleet.example.com";
    const response = await GET(new Request(`${origin}/api/auth`, { headers: { cookie: `fleethub_session=${token}` } }));
    const body = await response.json();
    expect(body).toMatchObject({ authenticated: true, authRequired: true, googleRedirectUri: "https://fleet.example.com/api/auth/callback/google" });
  });

  it("returns safe errors when login persistence is unavailable", async () => {
    database.bootstrapSuccess = false;
    expect((await post({ action: "login", email: "owner@example.com", password: "strong-password" })).status).toBe(503);
  });

  it("does not accept environment admin credentials as a login fallback", async () => {
    process.env.FLEETHUB_ADMIN_EMAIL = "admin@example.com";
    process.env.FLEETHUB_ADMIN_PASSWORD = "plaintext-secret";
    const response = await post({ action: "login", email: "admin@example.com", password: "plaintext-secret" });
    expect(response.status).toBe(401);
  });

  it("redacts database errors and reports registration only before the first user", async () => {
    expect((await (await GET(new Request(`${origin}/api/auth`))).json()).registrationAvailable).toBe(true);
    database.users.push({ id: "existing", email: "a@example.com", password_hash: "hash", name: "Owner", auth_provider: "local" });
    expect((await (await GET(new Request(`${origin}/api/auth`))).json()).registrationAvailable).toBe(false);
    database.fail = true;
    const response = await post({ action: "login", email: "a@example.com", password: "wrong" });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database connection string");
  });
});
