import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken } from "../src/lib/auth/session";
import { createServerSession } from "../src/lib/auth/sessions";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
import { queryClient } from "../src/lib/db/client";
import { githubReadToken, startGithubAuthorization } from "../src/lib/gitops/github-authorization";
import { DELETE, GET, POST } from "../src/app/api/gitops/github/route";
import { POST as syncGitops } from "../src/app/api/gitops/sync/route";
import { createBuiltinVault } from "../src/lib/vault/builtin";
import { createProject } from "../src/lib/projects/store";
import { GET as callback } from "../src/app/api/gitops/github/callback/route";

const origin = "https://fleet.example.test";
const endpoint = "/api/gitops/github";
const clientId = "fixture-app";
const subject = { id: `user-${randomUUID()}`, email: "operator@example.test", name: "Operator", provider: "local" as const, createdAt: Date.now() };
const name = `FLEETHUB_GITHUB_APP_${createHash("sha256").update(JSON.stringify([clientId, subject.id])).digest("hex")}`;
const credentials = (label: string, expiresIn = 28_800) => Response.json({
  access_token: `ghu_fixture_${label}`, refresh_token: `ghr_fixture_${label}`,
  token_type: "bearer", expires_in: expiresIn, refresh_token_expires_in: 15_897_600,
});

describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("GitHub App authorization with PostgreSQL", () => {
  let sid = "";
  let alternateSid = "";
  let readOnlySid = "";
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires disposable local database");
    expect((await bootstrapDatabase()).success).toBe(true);
    sid = await createServerSession(subject, "browser", "operator", "Primary");
    alternateSid = await createServerSession(subject, "browser", "operator", "Alternate");
    readOnlySid = await createServerSession(subject, "device", "read", "Read-only");
  });
  beforeEach(() => {
    vi.stubEnv("FLEETHUB_APP_URL", origin);
    vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true");
    vi.stubEnv("FLEETHUB_AUTH_SECRET", "fixture-auth-secret-for-session-signing-123");
    vi.stubEnv("FLEETHUB_SECRET_STORE_KEY", "fixture-encryption-key-for-test-only-123");
    vi.stubEnv("FLEETHUB_GITHUB_APP_CLIENT_ID", clientId);
    vi.stubEnv("FLEETHUB_GITHUB_APP_CLIENT_SECRET", "fixture-app-secret");
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await queryClient`DELETE FROM secret_store WHERE name = ${name}`;
  });
  afterAll(async () => {
    await queryClient`DELETE FROM auth_sessions WHERE user_id = ${subject.id}`;
    await queryClient.end();
  });

  function request(path = endpoint, method = "GET", session = sid, requestOrigin = origin) {
    return new Request(`${origin}${path}`, {
      method, headers: { origin: requestOrigin, cookie: `fleethub_session=${createSessionToken({ ...subject, sid: session })}` },
    });
  }

  async function begin() {
    const response = await POST(request(endpoint, "POST"));
    expect(response.status).toBe(200);
    const url = new URL((await response.json()).url);
    expect(url.origin).toBe("https://github.com");
    expect(url.searchParams.get("scope")).toBe("offline_access");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const state = url.searchParams.get("state");
    const code = "fixture-provider-code";
    return { url, state, code, path: `${endpoint}/callback?${new URLSearchParams({ state: state ?? "", code })}` };
  }

  it("requires an operator session and same-origin writes", async () => {
    expect((await POST(request(endpoint, "POST", readOnlySid))).status).toBe(403);
    expect((await POST(request(endpoint, "POST", sid, "https://other.example.test"))).status).toBe(403);
    expect((await GET(new Request(`${origin}${endpoint}`))).status).toBe(401);
    expect(await (await GET(request())).json()).toEqual({ status: "disconnected" });
    vi.stubEnv("FLEETHUB_GITHUB_APP_CLIENT_ID", "");
    expect(await (await GET(request())).json()).toEqual({ status: "not_configured" });
  });

  it("binds a one-use state to the initiating session, uses PKCE and encrypts tokens", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => credentials("first"));
    const { url, code, path } = await begin();
    expect((await callback(request(path, "GET", alternateSid))).headers.get("location")).toContain("github_connection=failed");
    expect(fetch).not.toHaveBeenCalled();
    const finished = await callback(request(path));
    expect(finished.headers.get("location")).toBe(`${origin}/?view=projects&github_connection=connected`);
    expect(finished.headers.get("referrer-policy")).toBe("no-referrer");
    expect(finished.headers.get("cache-control")).toBe("no-store");
    const [target, init] = fetch.mock.calls[0];
    expect(target).toBe("https://github.com/login/oauth/access_token");
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    if (!(init?.body instanceof URLSearchParams)) throw new Error("Expected a form body");
    expect(init.body.get("code")).toBe(code);
    expect(init.body.get("redirect_uri")).toBe(`${origin}${endpoint}/callback`);
    expect(createHash("sha256").update(init.body.get("code_verifier") ?? "").digest("base64url")).toBe(url.searchParams.get("code_challenge"));
    const replay = await callback(request(path));
    expect(replay.headers.get("location")).toContain("github_connection=failed");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [row] = await queryClient`SELECT ciphertext FROM secret_store WHERE name = ${name}`;
    expect(Buffer.from(row.ciphertext).toString("utf8")).not.toMatch(/gh[ur]_fixture/);
    expect(await githubReadToken(subject.id)).toBe("ghu_fixture_first");
    expect(await githubReadToken("another-user")).toBeUndefined();
    expect(await (await GET(request())).json()).toEqual({ status: "connected" });
  });

  it("serializes refresh, persists rotation across failed revoke and disconnects remotely", async () => {
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => credentials("initial", 1))
      .mockImplementationOnce(async () => credentials("rotated"))
      .mockImplementationOnce(async () => credentials("replacement", 1))
      .mockImplementationOnce(async () => credentials("revocable"))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect((await callback(request((await begin()).path))).headers.get("location")).toContain("github_connection=connected");
    const concurrent = await Promise.all([githubReadToken(subject.id), githubReadToken(subject.id)]);
    expect(concurrent).toEqual(["ghu_fixture_rotated", "ghu_fixture_rotated"]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await callback(request((await begin()).path))).headers.get("location")).toContain("github_connection=connected");
    const failed = await DELETE(request(endpoint, "DELETE"));
    expect(failed.status).toBe(503);
    const results = await Promise.all([githubReadToken(subject.id), githubReadToken(subject.id)]);
    expect(results).toEqual(["ghu_fixture_revocable", "ghu_fixture_revocable"]);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(await (await DELETE(request(endpoint, "DELETE"))).json()).toEqual({ status: "disconnected", outcome: "revoked" });
    expect(fetch.mock.calls[5][0]).toBe("https://api.github.com/applications/fixture-app/grant");
    expect(fetch.mock.calls[5][1]?.body).toBe(JSON.stringify({ access_token: "ghu_fixture_revocable" }));
    expect(await githubReadToken(subject.id)).toBeUndefined();
  });

  it("removes expired credentials without claiming GitHub revoked the authorization", async () => {
    const expiredAt = Date.now() - 1000;
    await createBuiltinVault().write(name, JSON.stringify({
      access: "ghu_fixture_expired", refresh: "ghr_fixture_expired",
      expiresAt: expiredAt, refreshExpiresAt: expiredAt,
    }));
    const fetch = vi.spyOn(globalThis, "fetch");
    expect(await (await GET(request())).json()).toEqual({ status: "reconnect" });
    expect(await (await DELETE(request(endpoint, "DELETE"))).json()).toEqual({ status: "disconnected", outcome: "expired" });
    expect(fetch).not.toHaveBeenCalled();
    expect(await githubReadToken(subject.id)).toBeUndefined();
  });

  it("retains credentials after a provider error and removes them after a definitive refresh rejection", async () => {
    const expiresAt = Date.now() - 1000;
    await createBuiltinVault().write(name, JSON.stringify({
      access: "ghu_fixture_old", refresh: "ghr_fixture_rejected",
      expiresAt, refreshExpiresAt: expiresAt + 3600_000,
    }));
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ error: "incorrect_client_credentials" }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ error: "bad_refresh_token" }));
    expect((await DELETE(request(endpoint, "DELETE"))).status).toBe(503);
    expect(await (await GET(request())).json()).toEqual({ status: "connected" });
    expect(await (await DELETE(request(endpoint, "DELETE"))).json()).toEqual({ status: "disconnected", outcome: "expired" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await githubReadToken(subject.id)).toBeUndefined();
  });

  it("does not expose provider error details and allows a fresh authorization", async () => {
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ error: "fixture-provider-private-error" }))
      .mockImplementationOnce(async () => credentials("reconnected"));
    const fail = await callback(request((await begin()).path));
    expect(fail.headers.get("location")).toBe(`${origin}/?view=projects&github_connection=failed`);
    expect(await fail.text()).not.toContain("fixture-provider-private-error");
    expect((await callback(request((await begin()).path))).headers.get("location")).toContain("github_connection=connected");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses the operator's OAuth credential through the normal GitOps sync route", async () => {
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => credentials("gitops"))
      .mockResolvedValueOnce(Response.json({ tree: [] }));
    const project = await createProject({ slug: "oauth-sync-fixture", name: "OAuth fixture", environment: "dev", criticality: "normal" }, null);
    try {
      expect((await callback(request((await begin()).path))).headers.get("location")).toContain("github_connection=connected");
      const base = request("/api/gitops/sync", "POST");
      const response = await syncGitops(new Request(base, {
        body: JSON.stringify({ projectId: project.id, repo: "fixture-owner/fixture-repo" }),
      }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ filesRead: 0, executed: false });
      expect(fetch.mock.calls[1][0]).toBe("https://api.github.com/repos/fixture-owner/fixture-repo/git/trees/main?recursive=1");
      expect(new Headers(fetch.mock.calls[1][1]?.headers).get("Authorization")).toBe("Bearer ghu_fixture_gitops");
    } finally {
      await queryClient`DELETE FROM projects WHERE id = ${project.id}`;
    }
  });

  it("requires HTTPS away from loopback", async () => {
    await expect(startGithubAuthorization({ id: subject.id, sid }, "http://fleet.example.test")).rejects.toMatchObject({ code: "not_configured" });
  });
});
