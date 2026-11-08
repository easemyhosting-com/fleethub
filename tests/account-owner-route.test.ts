import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ boot: vi.fn(), resolve: vi.fn(), set: vi.fn(), plan: vi.fn(), label: vi.fn(), archive: vi.fn(), enqueue: vi.fn(), identity: vi.fn() }));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: fixture.boot }));
vi.mock("@/lib/auth/rate-limit", () => ({ consumeSharedLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/auth/sessions", async importOriginal => ({ ...(await importOriginal<typeof import("../src/lib/auth/sessions")>()), resolveSession: fixture.resolve }));
vi.mock("@/lib/fleet/accounts", async importOriginal => ({ ...(await importOriginal<typeof import("../src/lib/fleet/accounts")>()), setAccountOwner: fixture.set, setAccountIdentity: fixture.identity, setAccountArchived: fixture.archive, setAccountPlan: fixture.plan, setAccountLabel: fixture.label }));
vi.mock("@/lib/inventory/service", () => ({ enqueueInventory: fixture.enqueue }));
import { createSessionToken } from "../src/lib/auth/session";
import { AccountOwnerError } from "../src/lib/fleet/accounts";
import { POST } from "../src/app/api/accounts/owner/route";
import { POST as ARCHIVE } from "../src/app/api/accounts/archive/route";

const user = { id: "usr-1", email: "op@example.test", name: "Op", provider: "local" as const, createdAt: Date.now() };
const sid = "ses-123e4567-e89b-12d3-a456-426614174000";
let counter = 0;
const cookie = () => `fleethub_session=${createSessionToken({ ...user, sid, id: `usr-${counter += 1}` })}`;
const origin = "http://localhost:3060"; const sameOrigin = { origin, "sec-fetch-site": "same-origin" };
const post = (body: unknown, headers: Record<string, string> = { cookie: cookie(), ...sameOrigin }) => POST(new Request(`${origin}/api/accounts/owner`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true"); vi.stubEnv("FLEETHUB_APP_URL", origin);
  vi.stubEnv("FLEETHUB_AUTH_SECRET", "owner-route-secret-at-least-32-bytes!!!!"); vi.stubEnv("FLEETHUB_API_KEY", "owner-admin-fixture"); vi.stubEnv("FLEETHUB_READONLY_KEY", "owner-reader-fixture");
  fixture.boot.mockReset().mockResolvedValue({ success: true }); fixture.set.mockReset(); fixture.archive.mockReset(); fixture.enqueue.mockReset().mockResolvedValue(undefined); fixture.identity.mockReset(); fixture.resolve.mockReset().mockResolvedValue({ user: null, failure: "none" });
});
afterEach(() => vi.unstubAllEnvs());

describe("/api/accounts/owner", () => {
  const body = { accountId: "acc-1", ownerEmail: "alex@example.com" };
  it("is operator-only", async () => {
    expect((await post(body, {})).status).toBe(401);
    expect((await post(body, { authorization: "Bearer owner-reader-fixture" })).status).toBe(403);
    expect(fixture.set).not.toHaveBeenCalled();
  });
  it("links an account to a person", async () => {
    fixture.resolve.mockResolvedValue({ user: { ...user, sid }, scope: "operator" });
    expect((await post({ accountId: "acc-1", identityId: "ident-alex-1" })).status).toBe(200);
    expect(fixture.identity).toHaveBeenCalledWith("acc-1", "ident-alex-1", "op@example.test", undefined);
    expect(fixture.set).not.toHaveBeenCalled();
    fixture.identity.mockRejectedValueOnce(new AccountOwnerError());
    expect((await post({ accountId: "acc-1", identityId: "ident-none" })).status).toBe(404);
    expect((await post({ accountId: "acc-1", identityId: "bad id!" })).status).toBe(400);
    expect((await post({ accountId: "acc-1", identityId: "ident-alex-1", email: "m@example.com" })).status).toBe(200);
    expect(fixture.identity).toHaveBeenLastCalledWith("acc-1", "ident-alex-1", "op@example.test", "m@example.com");
  });
  it("validates, saves with the actor and maps errors", async () => {
    fixture.resolve.mockResolvedValue({ user: { ...user, sid }, scope: "operator" });
    for (const bad of [{ accountId: "acc-1", ownerEmail: "nope" }, { accountId: "", ownerEmail: "a@b.co" }, { ...body, extra: 1 }]) expect((await post(bad)).status).toBe(400);
    expect((await post(body)).status).toBe(200);
    expect(fixture.set).toHaveBeenCalledWith("acc-1", "alex@example.com", "op@example.test");
    fixture.set.mockRejectedValueOnce(new AccountOwnerError());
    expect((await post(body)).status).toBe(404);
    fixture.set.mockRejectedValueOnce(new Error("postgres://leak"));
    const failed = await post(body);
    expect(failed.status).toBe(500); expect(JSON.stringify(await failed.json())).not.toContain("postgres://");
    fixture.boot.mockResolvedValue({ success: false });
    expect((await post(body)).status).toBe(503);
  });
});

describe("/api/accounts/archive", () => {
  const send = (body: unknown, headers: Record<string, string> = { cookie: cookie(), ...sameOrigin }) => ARCHIVE(new Request(`${origin}/api/accounts/archive`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
  it("is operator-only and validates input", async () => {
    expect((await send({ accountId: "acc-1", archived: true }, {})).status).toBe(401);
    expect((await send({ accountId: "acc-1", archived: true }, { authorization: "Bearer owner-reader-fixture" })).status).toBe(403);
    fixture.resolve.mockResolvedValue({ user: { ...user, sid }, scope: "operator" });
    expect((await send({ accountId: "acc-1" })).status).toBe(400);
  });
  it("archives without scanning and restores with a fresh scan", async () => {
    fixture.resolve.mockResolvedValue({ user: { ...user, sid }, scope: "operator" });
    expect((await send({ accountId: "acc-1", archived: true })).status).toBe(200);
    expect(fixture.archive).toHaveBeenCalledWith("acc-1", true, "op@example.test");
    expect(fixture.enqueue).not.toHaveBeenCalled();
    expect((await send({ accountId: "acc-1", archived: false })).status).toBe(200);
    expect(fixture.enqueue).toHaveBeenCalledWith("acc-1");
    fixture.archive.mockRejectedValueOnce(new AccountOwnerError());
    expect((await send({ accountId: "acc-9", archived: true })).status).toBe(404);
  });
});

describe("/api/accounts/owner plan", () => {
  it("sets the plan and rejects unknown values", async () => {
    fixture.resolve.mockResolvedValue({ user: { ...user, sid }, scope: "operator" });
    expect((await post({ accountId: "acc-1", plan: "free" })).status).toBe(200);
    expect(fixture.plan).toHaveBeenCalledWith("acc-1", "free", "op@example.test");
    expect((await post({ accountId: "acc-1", plan: "gold" })).status).toBe(400);
    expect((await post({ accountId: "acc-1", label: "  New name " })).status).toBe(200);
    expect(fixture.label).toHaveBeenCalledWith("acc-1", "New name", "op@example.test");
    expect((await post({ accountId: "acc-1", label: "   " })).status).toBe(400);
  });
});
