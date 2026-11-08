import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
import { POST } from "../src/app/api/auth/route";
import { consumeGoogleOAuthFlow, createGoogleOAuthFlow, verifySessionToken } from "../src/lib/auth/session";

describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("authentication with disposable PostgreSQL", () => {
  const origin = "http://localhost:3060";
  const setupToken = "integration-setup-token-only-32-characters";
  const password = "integration-password-only";
  const request = (body: unknown) => new Request(`${origin}/api/auth`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  beforeAll(async () => {
    const connection = new URL(process.env.DATABASE_URL ?? "");
    if (connection.pathname !== "/fleethub_security" || connection.hostname !== "127.0.0.1") {
      throw new Error("Auth integration tests require the dedicated local fleethub_security database");
    }
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("FLEETHUB_AUTH_SECRET", "integration-signing-secret-only-32-characters");
    vi.stubEnv("FLEETHUB_BOOTSTRAP_TOKEN", setupToken);
    vi.stubEnv("FLEETHUB_APP_URL", origin);
    vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true");
    vi.stubEnv("FLEETHUB_SEED_DEMO_DATA", "false");
    expect((await bootstrapDatabase()).success).toBe(true);
    await queryClient`TRUNCATE app_users, oauth_transactions`;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await queryClient.end();
  });

  it("creates exactly one operator during competing registrations and preserves its password", async () => {
    const attempts = ["first@example.test", "second@example.test"].map(email => ({
      action: "register", email, password, bootstrapToken: setupToken,
    }));
    const responses = await Promise.all(attempts.map(body => POST(request(body))));
    expect(responses.map(response => response.status).sort()).toEqual([200, 403]);
    const [operator] = await queryClient`SELECT email, password_hash FROM app_users`;
    expect(attempts.map(attempt => attempt.email)).toContain(operator.email);
    const takeover = await POST(request({ action: "register", email: operator.email, password: "attacker-password", bootstrapToken: setupToken }));
    expect(takeover.status).toBe(403);
    const [unchanged] = await queryClient`SELECT email, password_hash FROM app_users`;
    expect(unchanged.password_hash).toBe(operator.password_hash);
    const login = await POST(request({ action: "login", email: operator.email, password }));
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie");
    const token = cookie?.split(";")[0].slice("fleethub_session=".length) ?? "";
    expect(verifySessionToken(token)?.email).toBe(operator.email);
  });

  it("atomically consumes an OAuth transaction once across concurrent callbacks", async () => {
    const flow = await createGoogleOAuthFlow(origin, new Request(`${origin}/api/auth/google`));
    const state = new URL(flow.url).searchParams.get("state");
    const callback = () => new Request(`${origin}/api/auth/callback/google`, {
      headers: { cookie: flow.cookie.split(";")[0] },
    });
    const results = await Promise.all([
      consumeGoogleOAuthFlow(callback(), state), consumeGoogleOAuthFlow(callback(), state),
    ]);
    expect(results.filter(value => typeof value === "string")).toHaveLength(1);
    expect(results.filter(value => value === null)).toHaveLength(1);
    const verifier = results.find(value => typeof value === "string");
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await consumeGoogleOAuthFlow(callback(), state)).toBeNull();
  });
});
