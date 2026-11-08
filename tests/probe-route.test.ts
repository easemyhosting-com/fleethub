import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeSharedLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/inventory/probe", () => ({ probeCredential: fixture.probe }));
import { POST } from "../src/app/api/providers/test/route";

const origin = "http://localhost:3060";
const send = (body: unknown, headers: Record<string, string>) => POST(new Request(`${origin}/api/providers/test`, { method: "POST", headers: { "content-type": "application/json", origin, "sec-fetch-site": "same-origin", ...headers }, body: JSON.stringify(body) }));
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true"); vi.stubEnv("FLEETHUB_APP_URL", origin);
  vi.stubEnv("FLEETHUB_AUTH_SECRET", "probe-route-secret-at-least-32-bytes!!!!!"); vi.stubEnv("FLEETHUB_API_KEY", "probe-admin-fixture"); vi.stubEnv("FLEETHUB_READONLY_KEY", "probe-reader-fixture");
  fixture.probe.mockReset().mockResolvedValue({ ok: true, counts: {}, total: 0, missing: [], plan: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("/api/providers/test", () => {
  const body = { providerId: "cloudflare", config: { apiToken: "t", accountId: "a" } };
  it("needs an operator", async () => {
    expect((await send(body, {})).status).toBe(401);
    expect((await send(body, { authorization: "Bearer probe-reader-fixture" })).status).toBe(403);
    expect(fixture.probe).not.toHaveBeenCalled();
  });
  it("validates input and returns the probe result", async () => {
    const admin = { authorization: "Bearer probe-admin-fixture" };
    expect((await send({ providerId: "cloudflare" }, admin)).status).toBe(400);
    expect((await send({ ...body, extra: 1 }, admin)).status).toBe(400);
    const ok = await send(body, admin);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true });
    expect(fixture.probe).toHaveBeenCalledWith("cloudflare", body.config);
    expect(JSON.stringify(await (await send(body, admin)).json())).not.toContain("apiToken");
  });
});
