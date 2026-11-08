import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ authenticate: vi.fn(), recordNeed: vi.fn(), recordUsage: vi.fn(), bootstrap: vi.fn() }));
vi.mock("@/lib/projects/keys", async importOriginal => ({ ...(await importOriginal<object>()), authenticateProjectKey: fixture.authenticate }));
vi.mock("@/lib/projects/store", async importOriginal => ({ ...(await importOriginal<object>()), recordNeed: fixture.recordNeed, recordUsage: fixture.recordUsage }));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: fixture.bootstrap }));
vi.mock("@/lib/db/client", () => ({ queryClient: vi.fn() }));
import { POST as postNeed } from "../src/app/api/hooks/needs/route";
import { POST as postUsage } from "../src/app/api/hooks/usage/route";
import { createProjectInput, needInput, updateProjectInput, usageInput, validUsagePeriod } from "../src/lib/projects/schemas";
import { hookRequestsPerMinute } from "../src/lib/projects/hook-auth";
import { isProjectKeyFormat, hashProjectKey } from "../src/lib/projects/keys";
import { ReportConflict } from "../src/lib/projects/store";

const KEY = `fhp_${"a".repeat(43)}`;
const req = (path: string, body: unknown, over: Record<string, string | null> = {}) => {
  const headers: Record<string, string> = { authorization: `Bearer ${KEY}`, "x-fleethub-timestamp": new Date().toISOString(), "idempotency-key": "k1", "content-type": "application/json" };
  for (const [name, value] of Object.entries(over)) { if (value === null) delete headers[name]; else headers[name] = value; }
  return new Request(`http://localhost${path}`, { method: "POST", headers, body: JSON.stringify(body) });
};
const need = { kind: "database", purpose: "primary database", spec: { storageGb: 5 } };
const now = new Date();
const usage = { resource: "res-1", amount: 3, unit: "GB", periodStart: new Date(now.getTime() - 3600_000).toISOString(), periodEnd: now.toISOString(), metrics: { requests: 10 } };

beforeEach(() => {
  Object.values(fixture).forEach(mock => mock.mockReset());
  fixture.bootstrap.mockResolvedValue({ success: true });
  fixture.authenticate.mockResolvedValue({ status: "valid", projectId: "prj-1", keyId: "pkey-1" });
});

describe("project schemas", () => {
  it("accepts a need and rejects unknown keys, bad kinds and commands", () => {
    expect(needInput.safeParse(need).success).toBe(true);
    expect(needInput.safeParse({ ...need, command: "rm -rf /" }).success).toBe(false);
    expect(needInput.safeParse({ ...need, kind: "gpu" }).success).toBe(false);
  });
  it("accepts usage without any need and checks the period window", () => {
    const parsed = usageInput.parse(usage);
    expect(validUsagePeriod(parsed)).toBe(true);
    expect(validUsagePeriod({ ...parsed, periodEnd: new Date(Date.now() + 3600_000).toISOString() })).toBe(false);
    expect(usageInput.safeParse({ ...usage, periodEnd: usage.periodStart, periodStart: usage.periodEnd }).success).toBe(false);
  });
  it("validates project creation", () => {
    expect(createProjectInput.safeParse({ slug: "my-app", name: "My app", repoUrl: "https://github.com/a/b" }).success).toBe(true);
    expect(createProjectInput.safeParse({ slug: "My App", name: "x" }).success).toBe(false);
    expect(createProjectInput.safeParse({ slug: "ok", name: "x", repoUrl: "http://insecure.test" }).success).toBe(false);
  });
  it("recognises the project key format and stores only a hash", () => {
    expect(isProjectKeyFormat(KEY)).toBe(true);
    expect(isProjectKeyFormat("fhk_" + "a".repeat(43))).toBe(false);
    expect(hashProjectKey(KEY)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("project updates", () => {
  const id = "prj-00000000-0000-0000-0000-000000000000";
  it("allows only kind and name, and requires at least one", () => {
    expect(updateProjectInput.safeParse({ projectId: id, kind: "platform" }).success).toBe(true);
    expect(updateProjectInput.safeParse({ projectId: id, kind: "auto", name: "x" }).success).toBe(true);
    expect(updateProjectInput.safeParse({ projectId: id }).success).toBe(false);
    expect(updateProjectInput.safeParse({ projectId: id, kind: "weird" }).success).toBe(false);
    expect(updateProjectInput.safeParse({ projectId: id, kind: "app", slug: "other" }).success).toBe(false);
  });
});

describe("POST /api/hooks/needs", () => {
  it("records a need and answers with a recommendation that executed nothing", async () => {
    fixture.recordNeed.mockResolvedValue({ id: "need-1", duplicate: false, recommendation: { decision: "none_free", allocated: false } });
    const response = await postNeed(req("/api/hooks/needs", need));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ accepted: true, executed: false });
    expect(fixture.recordNeed).toHaveBeenCalledWith("prj-1", "k1", expect.objectContaining({ kind: "database" }));
  });
  it("returns 200 for a retry and 409 when the key is reused with a different body", async () => {
    fixture.recordNeed.mockResolvedValueOnce({ id: "need-1", duplicate: true, recommendation: {} });
    expect((await postNeed(req("/api/hooks/needs", need))).status).toBe(200);
    fixture.recordNeed.mockRejectedValueOnce(new ReportConflict());
    expect((await postNeed(req("/api/hooks/needs", need))).status).toBe(409);
  });
  it("rejects missing or invalid keys, stale timestamps, bad bodies and missing idempotency keys", async () => {
    expect((await postNeed(req("/api/hooks/needs", need, { authorization: null }))).status).toBe(401);
    fixture.authenticate.mockResolvedValueOnce({ status: "invalid" });
    expect((await postNeed(req("/api/hooks/needs", need))).status).toBe(401);
    fixture.authenticate.mockResolvedValueOnce({ status: "unavailable" });
    expect((await postNeed(req("/api/hooks/needs", need))).status).toBe(503);
    expect((await postNeed(req("/api/hooks/needs", need, { "x-fleethub-timestamp": new Date(Date.now() - 10 * 60_000).toISOString() }))).status).toBe(400);
    expect((await postNeed(req("/api/hooks/needs", { ...need, kind: "gpu" }))).status).toBe(400);
    expect((await postNeed(req("/api/hooks/needs", need, { "idempotency-key": null }))).status).toBe(400);
    expect(fixture.recordNeed).not.toHaveBeenCalled();
  });
  it("is unavailable when storage is", async () => {
    fixture.bootstrap.mockResolvedValue({ success: false });
    expect((await postNeed(req("/api/hooks/needs", need))).status).toBe(503);
  });
  it("rate limits a project after the per-minute budget", async () => {
    fixture.recordNeed.mockResolvedValue({ id: "n", duplicate: false, recommendation: {} });
    fixture.authenticate.mockResolvedValue({ status: "valid", projectId: "prj-limited", keyId: "pkey-2" });
    let last = 0;
    for (let i = 0; i <= hookRequestsPerMinute; i += 1) last = (await postNeed(req("/api/hooks/needs", need))).status;
    expect(last).toBe(429);
  });
});

describe("POST /api/hooks/usage", () => {
  it("accepts a usage report without any prior need, marked unverified", async () => {
    fixture.recordUsage.mockResolvedValue({ id: "use-1", duplicate: false, matched: false });
    const response = await postUsage(req("/api/hooks/usage", usage));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ accepted: true, matched: false, trust: "project_reported_unverified" });
    expect(fixture.recordNeed).not.toHaveBeenCalled();
  });
  it("rejects a future period, bad body and idempotency conflicts", async () => {
    expect((await postUsage(req("/api/hooks/usage", { ...usage, periodEnd: new Date(Date.now() + 86400_000).toISOString() }))).status).toBe(400);
    expect((await postUsage(req("/api/hooks/usage", { ...usage, action: "stop" }))).status).toBe(400);
    fixture.recordUsage.mockRejectedValueOnce(new ReportConflict());
    expect((await postUsage(req("/api/hooks/usage", usage))).status).toBe(409);
  });
  it("cannot reach another project: the project id comes only from the key", async () => {
    fixture.recordUsage.mockResolvedValue({ id: "use-2", duplicate: true, matched: true });
    await postUsage(req("/api/hooks/usage", { ...usage, projectId: "prj-other" }));
    expect(fixture.recordUsage).not.toHaveBeenCalled();
    await postUsage(req("/api/hooks/usage", usage));
    expect(fixture.recordUsage).toHaveBeenCalledWith("prj-1", "k1", expect.any(Object));
  });
});

describe("POST /api/hooks/gitops", () => {
  it("accepts manifests only for the key's own project and validates the body", async () => {
    const sync = vi.fn().mockResolvedValue({ gitops: 1, inferred: 0, suggested: 0, rejectedSkipped: 0, markedStale: 0, skipped: [] });
    vi.doMock("@/lib/gitops/sync", () => ({ syncProjectFromFiles: sync, UnknownProject: class extends Error {} }));
    vi.resetModules();
    const { POST } = await import("../src/app/api/hooks/gitops/route");
    const files = [{ path: "a/deploy.yaml", content: "kind: Deployment\nmetadata: { name: a }\n" }];
    const ok = await POST(req("/api/hooks/gitops", { files }));
    expect(ok.status).toBe(200); expect(await ok.json()).toMatchObject({ accepted: true, executed: false });
    expect(sync).toHaveBeenCalledWith("prj-1", files);
    expect((await POST(req("/api/hooks/gitops", { files, projectId: "prj-other" }))).status).toBe(400);
    expect((await POST(req("/api/hooks/gitops", { files: [] }))).status).toBe(400);
    expect((await POST(req("/api/hooks/gitops", { files }, { authorization: null }))).status).toBe(401);
  });
});
