import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  rows: new Map<string, { id: string; config: Record<string, unknown>; revision: number; status: "configured" | "verified" | "failed"; verifiedAt: Date | null; fingerprint: string | null; verificationId?: string | null; skipped?: boolean }>(),
  fail: false,
  boot: true,
  statements: [] as string[],
}));
const verification = vi.hoisted(() => ({ run: vi.fn<(...args: unknown[]) => Promise<void>>() }));
const auth = vi.hoisted(() => ({ allowed: true, write: true }));

vi.mock("@/lib/db/client", () => {
  async function query(strings: TemplateStringsArray, ...values: unknown[]) {
    const sql = strings.join("?").replace(/\s+/g, " ").trim();
    db.statements.push(sql);
    if (db.fail) throw new Error("private-postgres-secret");
    if (sql.startsWith("SELECT pg_advisory_xact_lock")) return [];
    if (sql.startsWith("SELECT id, config, revision")) return [...db.rows.values()].map(row => ({ ...row }));
    if (sql.startsWith("INSERT INTO onboarding_steps")) {
      if (sql.startsWith("INSERT INTO onboarding_steps (id, config, revision, status, skipped)")) {
        const id = String(values[0]);
        const old = db.rows.get(id);
        db.rows.set(id, old ? { ...old, skipped: true, revision: old.revision + 1 } : { id, config: {}, revision: 1, status: "configured", verifiedAt: null, fingerprint: null, skipped: true });
        return [];
      }
      const [id, raw] = values as [string, string];
      const old = db.rows.get(id);
      db.rows.set(id, { id, config: JSON.parse(raw), revision: (old?.revision ?? 0) + 1, status: "configured", verifiedAt: null, fingerprint: null, verificationId: null });
      return [];
    }
    if (sql.startsWith("UPDATE onboarding_steps SET status = 'configured'")) {
      const row = db.rows.get(String(values[0]));
      if (row) Object.assign(row, { status: "configured", verifiedAt: null, fingerprint: null, revision: row.revision + 1, verificationId: null });
      return [];
    }
    if (sql.startsWith("UPDATE onboarding_steps SET verification_id")) {
      const [attempt, id, revision] = values as [string, string, number];
      const row = db.rows.get(id);
      if (!row || row.revision !== revision) return [];
      row.verificationId = attempt;
      return [{ id }];
    }
    if (sql.startsWith("UPDATE onboarding_steps SET status = 'failed'")) {
      const [id, revision, attempt] = values as [string, number, string];
      const row = db.rows.get(id);
      if (row && row.revision === revision && row.verificationId === attempt) Object.assign(row, { status: "failed", verifiedAt: null, fingerprint: null });
      return [];
    }
    if (sql.startsWith("UPDATE onboarding_steps SET status = 'verified'")) {
      const [fingerprint, id, revision, attempt] = values as [string, string, number, string];
      const row = db.rows.get(id);
      if (!row || row.revision !== revision || row.verificationId !== attempt) return [];
      Object.assign(row, { status: "verified", verifiedAt: new Date(Date.now()), fingerprint, skipped: false });
      return [{ id }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
  return { queryClient: Object.assign(query, { begin: async (callback: (q: typeof query) => Promise<unknown>) => callback(query) }) };
});
vi.mock("@/lib/onboarding/verify", () => ({ verifyStep: verification.run }));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: vi.fn(async () => ({ success: db.boot })) }));
vi.mock("@/lib/auth/guard", () => ({
  verifyApiAccess: vi.fn(async (_req: Request, options?: { requireWrite?: boolean }) => ({ authorized: auth.allowed && (!options?.requireWrite || auth.write), status: 403, reason: "denied" })),
  createUnauthorizedResponse: vi.fn(() => new Response(JSON.stringify({ error: "Denied" }), { status: 403 })),
  readJsonWithLimit: vi.fn(async (request: Request) => {
    try {
      const text = await request.text();
      if (text.length > 16 * 1024) return { ok: false, status: 413, error: "Too large" };
      return { ok: true, data: JSON.parse(text) };
    } catch { return { ok: false, status: 400, error: "Invalid JSON" }; }
  }),
}));

import { GET, POST } from "../src/app/api/onboarding/route";
import { getSetupState, refreshStaleVaultSteps, runtimeFingerprint, saveSetupStep, verifySetupStep } from "../src/lib/onboarding/service";
import { freshnessMs } from "../src/lib/onboarding/model";

const configs = {
  tailscale: { tailnet: "example.ts.net", deviceId: "node_1" },
  infisical: { apiUrl: "http://infisical:8080", consoleUrl: "http://localhost:8088", projectId: "proj_1", environment: "dev", secretPath: "/" },
  cliproxy: { apiUrl: "http://cli-proxy-api:8317", consoleUrl: "http://localhost:8317" },
  builtin: {},
} as const;
const now = 1_800_000_000_000;
const url = "http://localhost:3060/api/onboarding";
function post(body: unknown) { return POST(new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } })); }
async function readyThrough(step: "tailscale" | "infisical" | "cliproxy") {
  for (const id of ["tailscale", "infisical", "cliproxy"] as const) {
    await saveSetupStep(id, configs[id]);
    await verifySetupStep(id);
    if (id === step) break;
  }
}

beforeEach(() => {
  db.rows.clear(); db.statements.length = 0; db.fail = false; db.boot = true;
  auth.allowed = true; auth.write = true;
  verification.run.mockReset().mockResolvedValue(undefined);
  vi.spyOn(Date, "now").mockReturnValue(now);
  vi.stubEnv("FLEETHUB_AUTH_SECRET", "a".repeat(64));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("persisted setup state", () => {
  it("persists optional skips without replacing a saved connection or granting readiness", async () => {
    expect((await post({ action: "skip", step: "tailscale" })).status).toBe(200);
    expect((await getSetupState()).steps[0]).toMatchObject({ skipped: true, status: "unconfigured", config: {} });
    expect((await getSetupState()).ready).toBe(false);
    await saveSetupStep("cliproxy", configs.cliproxy);
    await verifySetupStep("cliproxy");
    const before = db.rows.get("cliproxy");
    expect((await post({ action: "skip", step: "cliproxy" })).status).toBe(200);
    expect((await getSetupState()).steps[2]).toMatchObject({ skipped: true, status: "verified", config: configs.cliproxy });
    expect(db.rows.get("cliproxy")?.fingerprint).toBe(before?.fingerprint);
    await verifySetupStep("cliproxy");
    expect((await getSetupState()).steps[2].skipped).toBe(false);
    for (const step of ["builtin", "infisical"]) expect((await post({ action: "skip", step })).status).toBe(400);
  });
  it("starts unconfigured and resumes saved public settings after a read", async () => {
    expect(await getSetupState()).toMatchObject({ ready: false, steps: [
      { id: "tailscale", status: "unconfigured", revision: 0 },
      { id: "infisical", status: "unconfigured" },
      { id: "cliproxy", status: "unconfigured" },
      { id: "builtin", status: "unconfigured" },
    ] });
    await saveSetupStep("tailscale", configs.tailscale);
    const resumed = await getSetupState();
    expect(resumed.steps[0]).toMatchObject({ config: configs.tailscale, revision: 1, status: "configured" });
    expect(resumed.ready).toBe(false);
  });

  it("uses a signing secret for fingerprints and invalidates only the step whose credentials changed", async () => {
    await readyThrough("cliproxy");
    expect((await getSetupState()).ready).toBe(true);
    const fingerprint = runtimeFingerprint();
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    vi.stubEnv("CLIPROXY_MANAGEMENT_KEY", "rotated-private-key");
    expect(runtimeFingerprint()).not.toBe(fingerprint);
    const state = await getSetupState();
    expect(state.ready).toBe(true);
    expect(state.steps.map(step => step.status)).toEqual(["verified", "verified", "stale", "unconfigured"]);
    expect(JSON.stringify(state)).not.toContain("rotated-private-key");
    vi.stubEnv("TAILSCALE_API_TOKEN", "rotated-tailscale-token");
    expect((await getSetupState()).steps.map(step => step.status)).toEqual(["stale", "verified", "stale", "unconfigured"]);
    vi.stubEnv("INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET", "rotated-vault-secret");
    expect((await getSetupState()).ready).toBe(false);
    vi.stubEnv("FLEETHUB_AUTH_SECRET", "short");
    await expect(getSetupState()).rejects.toThrow("session signing secret");
  });

  it("names the invalid fields without echoing their values", async () => {
    const error = await saveSetupStep("infisical", { apiUrl: "http://infisical:8080", consoleUrl: "not a url", projectId: "bad id!", environment: "dev", secretPath: "/" }).catch((cause: Error) => cause);
    expect((error as Error).message).toBe("Invalid public connection settings. Check: consoleUrl, projectId");
  });

  it("lets an explicit setting extend freshness within bounds", async () => {
    await readyThrough("cliproxy");
    vi.stubEnv("FLEETHUB_SETUP_FRESHNESS_MINUTES", "60");
    vi.spyOn(Date, "now").mockReturnValue(now + freshnessMs + 1000);
    expect((await getSetupState()).ready).toBe(true);
    for (const bad of ["0", "1441", "abc", "1.5"]) { vi.stubEnv("FLEETHUB_SETUP_FRESHNESS_MINUTES", bad); expect((await getSetupState()).ready).toBe(false); }
  });

  it("expires verification at the freshness boundary and rejects future timestamps", async () => {
    await readyThrough("cliproxy");
    vi.spyOn(Date, "now").mockReturnValue(now + freshnessMs);
    expect((await getSetupState()).steps.map(step => step.status)).toEqual(["stale", "stale", "stale", "unconfigured"]);
    vi.spyOn(Date, "now").mockReturnValue(now - 60_000);
    expect((await getSetupState()).steps[0].status).toBe("stale");
    vi.spyOn(Date, "now").mockReturnValue(now - 1);
    expect((await getSetupState()).steps[0].status).toBe("verified");
  });

  it("re-verifies an aged-out secret store on demand, and stays unavailable when the re-check fails", async () => {
    await readyThrough("infisical");
    expect((await refreshStaleVaultSteps()).ready).toBe(true);
    const later = now + freshnessMs + 1000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    expect((await getSetupState()).ready).toBe(false);
    verification.run.mockRejectedValueOnce(new Error("down"));
    expect((await refreshStaleVaultSteps()).ready).toBe(false);
    expect((await getSetupState()).steps[1].status).toBe("failed");
    verification.run.mockResolvedValue(undefined);
    expect((await refreshStaleVaultSteps()).ready).toBe(false);
    expect((await verifySetupStep("infisical")).ready).toBe(true);
  });

  it("saving a step resets only that step, so other verified services stay verified", async () => {
    await readyThrough("cliproxy");
    const old = [...db.rows.values()].map(row => row.revision);
    const state = await saveSetupStep("tailscale", { tailnet: "changed.ts.net", deviceId: "node_1" });
    expect(state.steps.map(step => step.status)).toEqual(["configured", "verified", "verified", "unconfigured"]);
    expect([...db.rows.values()].map(row => row.revision)).toEqual([old[0] + 1, old[1], old[2]]);
    expect(state.ready).toBe(true);
    expect(db.statements.some(sql => sql.includes("pg_advisory_xact_lock"))).toBe(true);
  });

  it("rejects malformed saved configuration as failed without echoing it", async () => {
    db.rows.set("tailscale", { id: "tailscale", config: { token: "private-token" }, revision: 1, status: "verified", verifiedAt: new Date(now), fingerprint: runtimeFingerprint() });
    const state = await getSetupState();
    expect(state.steps[0].status).toBe("failed");
    expect(state.steps[0].config).toEqual({});
    expect(JSON.stringify(state)).not.toContain("private-token");
  });

  it("requires a saved step before any external verification but no other step", async () => {
    await expect(verifySetupStep("tailscale")).rejects.toThrow("Save connection settings");
    await saveSetupStep("infisical", configs.infisical);
    expect((await verifySetupStep("infisical")).ready).toBe(true);
    expect(verification.run).toHaveBeenCalledTimes(1);
  });

  it("is ready once either secret store is fresh; Tailscale and the gateway stay optional", async () => {
    await readyThrough("cliproxy");
    const state = await getSetupState();
    expect(state.ready).toBe(true);
    expect(state.steps.map(step => step.status)).toEqual(["verified", "verified", "verified", "unconfigured"]);
    expect(verification.run.mock.calls.map(call => call[0])).toEqual(["tailscale", "infisical", "cliproxy"]);
    db.rows.clear();
    await saveSetupStep("tailscale", configs.tailscale); await verifySetupStep("tailscale");
    expect((await getSetupState()).ready).toBe(false);
    await saveSetupStep("builtin", configs.builtin);
    expect((await verifySetupStep("builtin")).ready).toBe(true);
    expect(verification.run.mock.calls.at(-1)?.[0]).toBe("builtin");
  });

  it("fails closed when verification fails and keeps upstream diagnostic private", async () => {
    await saveSetupStep("tailscale", configs.tailscale);
    verification.run.mockRejectedValueOnce(new Error("private token in upstream response"));
    await expect(verifySetupStep("tailscale")).rejects.toThrow("private token");
    expect((await getSetupState()).steps[0].status).toBe("failed");
    expect(db.rows.get("tailscale")?.fingerprint).toBeNull();
  });

  it("rejects a successful probe if settings changed while it was running", async () => {
    await saveSetupStep("tailscale", configs.tailscale);
    let release!: () => void;
    verification.run.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const pending = verifySetupStep("tailscale");
    await vi.waitFor(() => expect(verification.run).toHaveBeenCalled());
    await saveSetupStep("tailscale", { tailnet: "new.ts.net", deviceId: "node_1" });
    release();
    await expect(pending).rejects.toThrow("Settings changed during verification");
    expect(db.rows.get("tailscale")?.status).toBe("configured");
  });

  it("does not let an older failed attempt overwrite a newer successful verification", async () => {
    await saveSetupStep("tailscale", configs.tailscale);
    let failOlder!: (error: Error) => void;
    verification.run.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { failOlder = reject; }));
    const older = verifySetupStep("tailscale");
    await vi.waitFor(() => expect(verification.run).toHaveBeenCalledTimes(1));
    const newer = verifySetupStep("tailscale");
    expect((await newer).steps[0].status).toBe("verified");
    failOlder(new Error("private older failure"));
    await expect(older).rejects.toThrow("private older failure");
    expect((await getSetupState()).steps[0].status).toBe("verified");
  });

  it("rejects a successful probe if runtime credentials change while it runs", async () => {
    await saveSetupStep("tailscale", configs.tailscale);
    let release!: () => void;
    verification.run.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const pending = verifySetupStep("tailscale");
    await vi.waitFor(() => expect(verification.run).toHaveBeenCalled());
    vi.stubEnv("TAILSCALE_API_TOKEN", "rotated");
    release();
    await expect(pending).rejects.toThrow("Runtime credentials changed");
    expect(db.rows.get("tailscale")?.status).toBe("configured");
  });

  it("propagates database errors so callers cannot report ready", async () => {
    db.fail = true;
    await expect(getSetupState()).rejects.toThrow("private-postgres-secret");
    await expect(saveSetupStep("tailscale", configs.tailscale)).rejects.toThrow("private-postgres-secret");
    await expect(verifySetupStep("tailscale")).rejects.toThrow("private-postgres-secret");
  });
});

describe("onboarding API boundary", () => {
  it("denies unauthorized reads and writes before touching the database", async () => {
    auth.allowed = false;
    expect((await GET(new Request(url))).status).toBe(403);
    expect((await post({ action: "save", step: "tailscale", config: configs.tailscale })).status).toBe(403);
    expect(db.statements).toEqual([]);
    auth.allowed = true; auth.write = false;
    expect((await post({ action: "save", step: "tailscale", config: configs.tailscale })).status).toBe(403);
  });

  it("rejects invalid JSON and requests before database access", async () => {
    const malformed = await POST(new Request(url, { method: "POST", body: "{" }));
    expect(malformed.status).toBe(400);
    for (const body of [{ action: "bad", step: "tailscale" }, { action: "save", step: "unknown", config: {} }, { action: "verify", step: "tailscale", config: {} }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(db.statements).toEqual([]);
  });

  it("returns saved state and verifies without exposing keys", async () => {
    const saved = await post({ action: "save", step: "tailscale", config: configs.tailscale });
    expect(saved.status).toBe(200);
    expect(saved.headers.get("Cache-Control")).toBe("no-store");
    const verified = await post({ action: "verify", step: "tailscale" });
    expect(verified.status).toBe(200);
    const read = await GET(new Request(url));
    expect(read.status).toBe(200);
    expect((await read.json()).steps[0].status).toBe("verified");
  });

  it("returns safe validation and failure responses", async () => {
    const invalid = await post({ action: "save", step: "tailscale", config: { ...configs.tailscale, secret: "private" } });
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).not.toContain("private");
    const failed = await post({ action: "verify", step: "tailscale" });
    expect(failed.status).toBe(422);
    expect(await failed.text()).toContain("Save connection settings");
    await saveSetupStep("tailscale", configs.tailscale);
    verification.run.mockRejectedValueOnce(new Error("private upstream body"));
    const upstream = await post({ action: "verify", step: "tailscale" });
    expect(upstream.status).toBe(422);
    expect(await upstream.text()).not.toContain("private upstream body");
  });

  it("returns an unavailable read and safe write failure for bootstrap or database errors", async () => {
    db.boot = false;
    expect((await GET(new Request(url))).status).toBe(503);
    expect((await post({ action: "save", step: "tailscale", config: configs.tailscale })).status).toBe(503);
    db.boot = true; db.fail = true;
    const read = await GET(new Request(url));
    expect(read.status).toBe(503);
    expect(await read.text()).not.toContain("private-postgres-secret");
    const write = await post({ action: "save", step: "tailscale", config: configs.tailscale });
    expect(write.status).toBe(422);
    expect(await write.text()).not.toContain("private-postgres-secret");
  });
});
