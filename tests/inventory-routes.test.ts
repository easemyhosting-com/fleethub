import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  accounts: [] as Record<string, unknown>[],
  resources: [] as Record<string, unknown>[],
  worker: null as string | null,
  fail: false,
  collectionState: "queued",
  statements: [] as string[],
}));

vi.mock("@/lib/db/client", () => ({
  queryClient: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?").replace(/\s+/g, " ").trim();
    fixture.statements.push(sql);
    if (fixture.fail) throw new Error("private database password");
    if (sql.startsWith("SELECT a.id, a.kind")) {
      return fixture.accounts.filter(a => (!values[0] || a.id === values[0]) && (!values[2] || a.owner_email === values[2]));
    }
    if (sql.startsWith("SELECT r.id, r.account_id")) {
      return fixture.resources.filter(r => (!values[0] || r.account_id === values[0]) && (!values[2] || fixture.accounts.some(a => a.id === r.account_id && a.owner_email === values[2])));
    }
    if (sql.startsWith("SELECT id, name, kind, tailscale_ip")) return [];
    if (sql.startsWith("SELECT last_seen_at FROM inventory_worker")) return fixture.worker ? [{ last_seen_at: fixture.worker }] : [];
    if (sql.startsWith("SELECT kind, secret_ref_id FROM provider_accounts")) {
      const a = fixture.accounts.find(account => account.id === values[0]);
      return a ? [{ kind: a.kind, secret_ref_id: a.secret_ref_id }] : [];
    }
    if (sql.startsWith("UPDATE account_collections c SET state")) return { count: fixture.collectionState === "error" ? 1 : 0 };
    if (sql.startsWith("INSERT INTO account_collections")) {
      if (fixture.collectionState !== "running") fixture.collectionState = "queued";
      return Object.assign([], { count: 1 });
    }
    if (sql.startsWith("INSERT INTO resources")) {
      const a = fixture.accounts.find(account => account.id === values[5]);
      if (!a) return Object.assign([], { count: 0 });
      const id = String(values[0]);
      const previous = fixture.resources.find(r => r.id === id);
      if (previous) {
        previous.name = values[1]; previous.category = values[2]; previous.region = values[4];
        previous.is_protected = Boolean(previous.is_protected || a.is_protected || a.kind === "oracle");
      } else fixture.resources.push({ id, name: values[1], category: values[2], provider: a.kind,
        account_id: a.id, account_email: a.owner_email, state: "unknown", is_protected: Boolean(a.is_protected || a.kind === "oracle"),
        tags: [], attributes: {}, last_seen_at: new Date().toISOString(), native_id: values[3], region: values[4],
        source_url: null, inventory_source: "manual", retired_at: null, last_success_at: null, collection_state: null,
        account_protected: a.is_protected, account_kind: a.kind });
      return Object.assign([], { count: 1 });
    }
    throw new Error(`Unexpected query: ${sql}`);
  },
}));

import { GET as fleetGET } from "../src/app/api/fleet/route";
import { POST as manualPOST } from "../src/app/api/resources/route";
import { POST as refreshPOST } from "../src/app/api/inventory/refresh/route";

const base = "http://localhost:3030";
const now = () => new Date().toISOString();
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
function account(overrides: Record<string, unknown> = {}) {
  return { id: "acc-a", kind: "cloudflare", label: "Primary", owner_email: "owner@example.test", login_email: "login@example.test",
    health: "ok", enabled: true, is_protected: false, secret_ref_id: "ref-private", collection_state: "ready",
    last_attempt_at: now(), last_success_at: now(), next_attempt_at: now(), error_code: null, resource_count: 1, ...overrides };
}
function resource(overrides: Record<string, unknown> = {}) {
  return { id: "inv-one", account_id: "acc-a", account_email: "owner@example.test", provider: "cloudflare", name: "Zone",
    category: "network", state: "online", is_protected: false, account_protected: false, account_kind: "cloudflare",
    tags: ["brain", "private-token"], attributes: { sizeGb: 4, apiToken: "secret" }, last_seen_at: now(), native_id: "zone-1",
    region: null, source_url: "https://dash.cloudflare.com/zone-1", inventory_source: "provider", retired_at: null,
    last_success_at: now(), collection_state: "ready", ...overrides };
}
function request(path: string, method = "GET", body?: unknown, token = "admin-fixture") {
  return new Request(`${base}${path}`, { method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  fixture.accounts = [account()]; fixture.resources = [resource()]; fixture.worker = now();
  fixture.fail = false; fixture.collectionState = "queued"; fixture.statements.length = 0;
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true");
  vi.stubEnv("FLEETHUB_AUTH_SECRET", "signing-fixture-".repeat(4));
  vi.stubEnv("FLEETHUB_API_KEY", "admin-fixture"); vi.stubEnv("FLEETHUB_READONLY_KEY", "reader-fixture");
});
afterEach(() => vi.unstubAllEnvs());

describe("stored fleet route", () => {
  it("enforces auth, returns no-store filtered snapshots, and removes private resource fields", async () => {
    expect((await fleetGET(new Request(`${base}/api/fleet`))).status).toBe(401);
    const response = await fleetGET(request("/api/fleet?accountId=acc-a&ownerEmail=owner%40example.test", "GET", undefined, "reader-fixture"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const snapshot = await response.json();
    expect(snapshot).toMatchObject({ status: "online", worker: { status: "online" } });
    expect(snapshot.accounts[0]).toMatchObject({ id: "acc-a", collection: { state: "ready", resourceCount: 1 } });
    expect(snapshot.resources[0]).toMatchObject({ nativeId: "zone-1", freshness: "current", tags: ["brain"], attributes: { sizeGb: 4 } });
    expect(JSON.stringify(snapshot)).not.toMatch(/ref-private|private-token|apiToken|secret/);
    expect(fixture.statements.every(sql => !/Infisical|vaultSession|collectInventory/.test(sql))).toBe(true);
  });

  it("distinguishes stale, prior-error, unsupported, pending, and worker-offline states", async () => {
    fixture.accounts = [
      account({ id: "old", collection_state: "ready", last_success_at: ago(20), resource_count: 0 }),
      account({ id: "failed", collection_state: "error", error_code: "unauthorized", last_success_at: ago(1), resource_count: 1 }),
      account({ id: "oracle", kind: "gcp", secret_ref_id: null, collection_state: null, last_success_at: null, resource_count: 0 }),
      account({ id: "pending", secret_ref_id: null, collection_state: null, last_success_at: null, resource_count: 0 }),
      account({ id: "queued", collection_state: "queued", last_success_at: null, resource_count: 0 }),
      account({ id: "running", collection_state: "running", last_success_at: now(), resource_count: 0 }),
    ];
    fixture.resources = [resource({ account_id: "failed", collection_state: "error", last_success_at: ago(1) }),
      resource({ id: "manual", account_id: "old", inventory_source: "manual", retired_at: null }),
      resource({ id: "retired", account_id: "old", retired_at: ago(1), last_success_at: ago(20) })];
    fixture.worker = ago(2);
    const snapshot = await (await fleetGET(request("/api/fleet"))).json();
    const states = Object.fromEntries(snapshot.accounts.map((a: { id: string; collection: { state: string } }) => [a.id, a.collection.state]));
    expect(states).toMatchObject({ old: "stale", failed: "stale", oracle: "unsupported", pending: "needs_credentials", queued: "queued", running: "running" });
    expect(snapshot.accounts.find((a: { id: string }) => a.id === "failed").collection).toMatchObject({ errorCode: "unauthorized" });
    expect(snapshot.worker.status).toBe("offline");
    expect(snapshot.resources.map((r: { freshness: string }) => r.freshness)).toEqual(["stale", "unverified", "stale"]);
    expect(snapshot.resources[2].presence).toBe("missing");
  });

  it("returns 503 without fake empty arrays on database or DTO failures", async () => {
    fixture.fail = true;
    const unavailable = await fleetGET(request("/api/fleet"));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ status: "unavailable", error: "Inventory database unavailable" });
    fixture.fail = false;
    fixture.accounts = [account({ resource_count: null })];
    expect((await fleetGET(request("/api/fleet"))).status).toBe(503);
  });
});

describe("manual resource route", () => {
  const input = { accountId: "acc-a", nativeId: "manual-1", name: "Manual", category: "network" };
  it("rejects unauthorized, read-only, malformed, and unknown-account writes", async () => {
    expect((await manualPOST(new Request(`${base}/api/resources`, { method: "POST", body: JSON.stringify(input) }))).status).toBe(401);
    expect((await manualPOST(request("/api/resources", "POST", input, "reader-fixture"))).status).toBe(403);
    expect((await manualPOST(request("/api/resources", "POST", { ...input, apiToken: "secret" }))).status).toBe(400);
    expect((await manualPOST(request("/api/resources", "POST", { ...input, category: "invalid" }))).status).toBe(400);
    expect((await manualPOST(request("/api/resources", "POST", { ...input, accountId: "missing" }))).status).toBe(404);
  });

  it("uses stable manual IDs, unknown state, account protection, and never lowers protection", async () => {
    fixture.accounts = [account({ kind: "oracle", is_protected: false })];
    const first = await manualPOST(request("/api/resources", "POST", input));
    const second = await manualPOST(request("/api/resources", "POST", { ...input, name: "Renamed" }));
    expect(first.status).toBe(201); expect(second.status).toBe(201);
    expect(first.headers.get("cache-control")).toBe("no-store");
    const firstBody = await first.json(); const secondBody = await second.json();
    expect(firstBody).toMatchObject({ id: secondBody.id, state: "unknown" });
    expect(firstBody.id).toMatch(/^manual-/);
    expect(fixture.resources.find(r => r.id === firstBody.id)).toMatchObject({ name: "Renamed", is_protected: true, state: "unknown" });
    fixture.accounts = [account({ kind: "cloudflare", is_protected: false })];
    await manualPOST(request("/api/resources", "POST", { ...input, name: "Again" }));
    expect(fixture.resources.find(r => r.id === firstBody.id)?.is_protected).toBe(true);
    expect(JSON.stringify(fixture.resources.find(r => r.id === firstBody.id))).not.toContain("apiToken");
    fixture.fail = true;
    expect((await manualPOST(request("/api/resources", "POST", input))).status).toBe(503);
  });
});

describe("inventory refresh route", () => {
  it("validates authorization, payload, account support, credentials, and database availability", async () => {
    expect((await refreshPOST(new Request(`${base}/api/inventory/refresh`, { method: "POST", body: JSON.stringify({ accountId: "acc-a" }) }))).status).toBe(401);
    expect((await refreshPOST(request("/api/inventory/refresh", "POST", { accountId: "acc-a" }, "reader-fixture"))).status).toBe(403);
    expect((await refreshPOST(request("/api/inventory/refresh", "POST", { accountId: "bad id" }))).status).toBe(400);
    expect((await refreshPOST(request("/api/inventory/refresh", "POST", { accountId: "missing" }))).status).toBe(404);
    fixture.accounts = [account({ kind: "gcp" })];
    expect((await refreshPOST(request("/api/inventory/refresh", "POST", { accountId: "acc-a" }))).status).toBe(409);
    fixture.accounts = [account({ secret_ref_id: null })];
    expect((await refreshPOST(request("/api/inventory/refresh", "POST", { accountId: "acc-a" }))).status).toBe(409);
    fixture.fail = true;
    const unavailable = await refreshPOST(request("/api/inventory/refresh", "POST", { accountId: "acc-a" }));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain("private database password");
  });

  it("accepts an explicit empty-scan confirmation only when one is pending", async () => {
    const path = "/api/inventory/refresh";
    const body = { accountId: "acc-a", confirmEmpty: true };
    expect((await refreshPOST(request(path, "POST", body, "reader-fixture"))).status).toBe(403);
    expect((await refreshPOST(request(path, "POST", body))).status).toBe(409);
    fixture.collectionState = "error";
    expect((await refreshPOST(request(path, "POST", body))).status).toBe(202);
  });

  it("queues credentialed accounts and reports accepted for a coalesced running job", async () => {
    const pending = await refreshPOST(request("/api/inventory/refresh", "POST", { accountId: "acc-a" }));
    expect(pending.status).toBe(202);
    expect(pending.headers.get("cache-control")).toBe("no-store");
    expect(await pending.json()).toEqual({ state: "queued" });
    fixture.collectionState = "running";
    const running = await refreshPOST(request("/api/inventory/refresh", "POST", { accountId: "acc-a" }));
    expect(running.status).toBe(202);
    expect(fixture.collectionState).toBe("running");
  });
});
