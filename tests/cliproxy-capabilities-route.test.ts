import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/onboarding/cliproxy-capabilities/route";
const mocks = vi.hoisted(() => ({ access: vi.fn(), bootstrap: vi.fn(), state: vi.fn(), inspect: vi.fn() }));
vi.mock("@/lib/auth/guard", () => ({ verifyApiAccess: mocks.access, createUnauthorizedResponse: () => Response.json({ error: "Unauthorized" }, { status: 401 }) }));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: mocks.bootstrap }));
vi.mock("@/lib/onboarding/service", () => ({ getSetupState: mocks.state }));
vi.mock("@/lib/cliproxy/capabilities", () => ({ inspectCliProxy: mocks.inspect }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ authorized: true });
  mocks.bootstrap.mockResolvedValue({ success: true });
  mocks.state.mockResolvedValue({ steps: [{ id: "cliproxy", status: "configured", config: { apiUrl: "https://gateway.example.test" } }] });
  mocks.inspect.mockResolvedValue({ schemaVersion: 1 });
});
const request = () => new Request("http://localhost/api/onboarding/cliproxy-capabilities");
it("requires operator access before touching setup or gateway", async () => {
  mocks.access.mockResolvedValue({ authorized: false });
  expect((await GET(request())).status).toBe(401);
  expect(mocks.access).toHaveBeenCalledWith(expect.any(Request), { requireWrite: true });
  expect(mocks.bootstrap).not.toHaveBeenCalled();
  expect(mocks.inspect).not.toHaveBeenCalled();
});
it("returns bounded redacted capability results with no-store", async () => {
  const result = await GET(request());
  expect(await result.json()).toEqual({ schemaVersion: 1 });
  expect(result.headers.get("cache-control")).toBe("no-store");
});
it("reports missing settings and database outages without probing", async () => {
  mocks.bootstrap.mockResolvedValue({ success: false });
  expect((await GET(request())).status).toBe(503);
  mocks.bootstrap.mockResolvedValue({ success: true });
  mocks.state.mockResolvedValue({ steps: [] });
  expect((await GET(request())).status).toBe(409);
  expect(mocks.inspect).not.toHaveBeenCalled();
});
it("suppresses internal exception content", async () => {
  mocks.inspect.mockRejectedValue(new Error("private-token private.example.test"));
  const result = await GET(request());
  expect(result.status).toBe(422);
  expect(await result.text()).not.toContain("private");
});
