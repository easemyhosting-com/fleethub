import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ writes: [] as unknown[][], refs: [] as Record<string, unknown>[], failWrite: false, failStatus: false }));

vi.mock("@/lib/auth/guard", () => ({
  verifyApiAccess: async () => ({ authorized: true, status: 200 }),
  createUnauthorizedResponse: () => new Response(null, { status: 401 }),
  readJsonWithLimit: async (req: Request) => ({ ok: true, data: await req.json() }),
}));
vi.mock("@/lib/db/client", () => ({
  queryClient: async (_strings: TemplateStringsArray, ...values: unknown[]) => { if (fixture.failWrite) throw new Error("synthetic diagnostic context"); fixture.writes.push(values); return []; },
}));
vi.mock("@/lib/infisical/client", () => ({
  getInfisicalStatus: async () => { if (fixture.failStatus) throw Object.assign(new Error("synthetic upstream body for user@example.com"), { code: "E_SYNTH" }); return { workspaces: [], totalSecretKeys: 0, secretReferences: fixture.refs }; },
}));

import { POST } from "../src/app/api/infisical/route";

const ref = (id: string, status: string) => ({ id, provider: id, workspaceName: id, environment: "prod", path: `/projects/${id}/prod`, keys: ["A"], status });

afterEach(() => { fixture.writes = []; fixture.refs = []; fixture.failWrite = false; fixture.failStatus = false; vi.restoreAllMocks(); });

describe("POST /api/infisical sync", () => {
  it("returns a generic error and logs only the error class and code", async () => {
    fixture.failStatus = true;
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await POST(new Request("http://x/api/infisical", { method: "POST", body: JSON.stringify({ action: "sync" }) }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Infisical request failed" });
    expect(logged).toHaveBeenCalledExactlyOnceWith("[Infisical API] request failed:", "Error E_SYNTH");
  });
  it("stores each reference's real status and only timestamps verified ones", async () => {
    fixture.refs = [ref("ok", "verified"), ref("unlisted", "pending")];
    const res = await POST(new Request("http://x/api/infisical", { method: "POST", body: JSON.stringify({ action: "sync" }) }));
    expect(res.status).toBe(200);
    const [verified, pending] = fixture.writes;
    expect(verified[6]).toBe("verified");
    expect(verified[7]).toBeInstanceOf(Date);
    expect(pending[6]).toBe("pending");
    expect(pending[7]).toBeNull();
  });
  it("does not log database diagnostics or reference identifiers when sync fails", async () => {
    fixture.refs = [ref("synthetic-reference-id", "verified")];
    fixture.failWrite = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await POST(new Request("http://x/api/infisical", { method: "POST", body: JSON.stringify({ action: "sync" }) }));
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalledExactlyOnceWith("[DB] Secret reference sync failed");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("synthetic diagnostic context");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("synthetic-reference-id");
  });

});
