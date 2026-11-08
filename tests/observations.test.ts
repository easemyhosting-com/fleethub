import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const fixture = vi.hoisted(() => ({ query: vi.fn(), bootstrap: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ queryClient: fixture.query }));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: fixture.bootstrap }));
import { POST, GET } from "../src/app/api/observations/route";
import { verifyApiAccess } from "../src/lib/auth/guard";
import { observationInput, validObservationTime } from "../src/lib/observations/report";
const reporter = "reporter-fixture-".repeat(3);
const input = () => ({ resourceId: "host-1", source: "external_agent", observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), facts: { connectivity: { ssh: "reachable" } } });
function request(body: unknown = input(), key = "report-1", token = reporter) { return new Request("http://localhost/api/observations", { method: "POST", headers: { authorization: `Bearer ${token}`, "idempotency-key": key, "content-type": "application/json" }, body: JSON.stringify(body) }); }
beforeEach(() => {
 fixture.query.mockReset().mockResolvedValue([{ id: "obs-1" }]); fixture.bootstrap.mockReset().mockResolvedValue({ success: true });
 vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("FLEETHUB_AUTH_REQUIRED", "true"); vi.stubEnv("FLEETHUB_AUTH_SECRET", "signing-fixture-".repeat(4));
 vi.stubEnv("FLEETHUB_OBSERVATION_KEY", reporter); vi.stubEnv("FLEETHUB_API_KEY", "admin-fixture"); vi.stubEnv("FLEETHUB_READONLY_KEY", "reader-fixture");
});
afterEach(() => vi.unstubAllEnvs());
it("accepts a scoped reporter and never changes inventory", async () => {
 const response = await POST(request()); expect(response.status).toBe(201);
 expect(await response.json()).toMatchObject({ accepted: true, authoritative: false, duplicate: false });
 const [sql, ...values] = fixture.query.mock.calls[0]; expect(sql.join("?")).toContain("INSERT INTO external_observations"); expect(sql.join("?")).not.toMatch(/UPDATE|DELETE/);
 expect(values.some(value => typeof value === "string" && value.startsWith("agent:"))).toBe(true);
 expect(values).not.toContain(reporter);
});
it("restricts the reporter to this POST endpoint and denies read-only writes", async () => {
 expect((await GET(new Request("http://localhost/api/observations", { headers: { authorization: `Bearer ${reporter}` } }))).status).toBe(401);
 expect((await verifyApiAccess(new Request("http://localhost/api/providers", { method: "POST", headers: { authorization: `Bearer ${reporter}` } }), { allowObservationKey: true, skipRateLimit: true })).authorized).toBe(false);
 expect((await POST(request(input(), "read-denied", "reader-fixture"))).status).toBe(403);
 vi.stubEnv("FLEETHUB_AUTH_SECRET", "short"); expect((await POST(request())).status).toBe(401);
});
it("deduplicates identical reports and rejects conflicting retries", async () => {
 const body = input(); const parsed = observationInput.parse(body); const hash = createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
 fixture.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "existing", payloadHash: hash }]);
 expect((await POST(request(body))).status).toBe(200);
 fixture.query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "existing", payloadHash: "different" }]);
 expect((await POST(request(body))).status).toBe(409);
 fixture.query.mockResolvedValue([]); expect((await POST(request(body))).status).toBe(404);
});
it("rejects secrets, policy changes, missing keys and invalid timestamps", async () => {
 expect((await POST(request({ ...input(), password: "secret" }))).status).toBe(400);
 expect((await POST(request({ ...input(), facts: { isProtected: false } }))).status).toBe(400);
 expect((await POST(request(input(), ""))).status).toBe(400);
 expect((await POST(request({ ...input(), expiresAt: new Date(0).toISOString() }))).status).toBe(400);
 expect((await POST(request({ padding: "x".repeat(17000) }))).status).toBe(413);
 expect(validObservationTime(observationInput.parse({ ...input(), observedAt: new Date(Date.now()+120000).toISOString() }))).toBe(false);
});
it("exposes expired reports as unverified and handles database failures", async () => {
 fixture.query.mockResolvedValue([{ id: "obs", expiresAt: new Date(0), facts: { resourceState: "offline" } }]);
 const read = (suffix = "") => new Request(`http://localhost/api/observations${suffix}`, { headers: { authorization: "Bearer reader-fixture" } });
 expect((await (await GET(read())).json()).observations[0]).toMatchObject({ freshness: "expired", authoritative: false, trust: "external_report_unverified" });
 expect((await GET(read("?resourceId=host-1"))).status).toBe(200);
 expect((await GET(read("?resourceId=bad%20id"))).status).toBe(400);
 fixture.query.mockRejectedValue(new Error("private diagnostic")); expect((await GET(read())).status).toBe(503);
 expect((await POST(request())).status).toBe(503);
 fixture.bootstrap.mockResolvedValue({ success: false }); expect((await POST(request())).status).toBe(503); expect((await GET(read())).status).toBe(503);
});
