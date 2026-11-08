import { beforeEach, expect, it, vi } from "vitest";
const fx = vi.hoisted(() => ({ authorized: true, operator: true, interval: vi.fn(), rotate: vi.fn(), revoke: vi.fn(), connectors: vi.fn(), hosts: vi.fn() }));
vi.mock("@/lib/auth/guard", () => ({
  verifyApiAccess: vi.fn(async () => ({ authorized: fx.authorized })),
  isOperator: () => fx.operator,
  createUnauthorizedResponse: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
  readJsonWithLimit: async (req: Request) => ({ ok: true, data: await req.json() }),
}));
vi.mock("@/lib/db/bootstrap", () => ({ bootstrapDatabase: async () => ({ success: true }) }));
vi.mock("@/lib/connectors/service", () => ({ createConnector: vi.fn(), deleteConnector: vi.fn(), listConnectors: fx.connectors, listConnectorHosts: fx.hosts, SecretStoreNotReady: class extends Error {} }));
vi.mock("@/lib/connectors/schedule", () => ({ setScanInterval: fx.interval, rotateRescanKey: fx.rotate, revokeRescanKey: fx.revoke, UnknownConnectorId: class extends Error {} }));
import { GET, PATCH } from "../src/app/api/connectors/route";
import { UnknownConnectorId } from "../src/lib/connectors/schedule";
const id = "conn-00000000-0000-0000-0000-000000000001";
const patch = (body: object) => PATCH(new Request("http://localhost/api/connectors", { method: "PATCH", body: JSON.stringify({ id, ...body }) }));
beforeEach(() => { fx.authorized = true; fx.operator = true; vi.clearAllMocks(); });
it("requires write authentication and an operator before touching schedule settings", async () => {
  fx.authorized = false;
  expect((await patch({ scanIntervalMinutes: 15 })).status).toBe(401);
  fx.authorized = true; fx.operator = false;
  expect((await patch({ rescanKey: "rotate" })).status).toBe(403);
  expect(fx.interval).not.toHaveBeenCalled(); expect(fx.rotate).not.toHaveBeenCalled();
});
it("rejects empty updates and unsupported intervals", async () => {
  expect((await patch({})).status).toBe(400);
  expect((await patch({ scanIntervalMinutes: 1 })).status).toBe(400);
  expect((await patch({ rescanKey: "rotate", extra: true })).status).toBe(400);
  expect(fx.interval).not.toHaveBeenCalled();
});
it("sets manual or default schedules and returns a rotated key only in the response", async () => {
  expect((await patch({ scanIntervalMinutes: 0 })).status).toBe(200);
  expect(fx.interval).toHaveBeenLastCalledWith(id, 0);
  expect((await patch({ scanIntervalMinutes: null })).status).toBe(200);
  expect(fx.interval).toHaveBeenLastCalledWith(id, null);
  fx.rotate.mockResolvedValueOnce("fixture-key");
  const response = await patch({ rescanKey: "rotate" });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ updated: true, rescanKey: "fixture-key" });
});
it("reports nonexistent connectors on revocation", async () => {
  fx.revoke.mockRejectedValueOnce(new UnknownConnectorId());
  expect((await patch({ rescanKey: "revoke" })).status).toBe(404);
});

it("keeps the connector list available when the host picker cannot load", async () => {
  fx.connectors.mockResolvedValueOnce([{ id, label: "example" }]);
  fx.hosts.mockRejectedValueOnce(new Error("unavailable"));
  const response = await GET(new Request("http://localhost/api/connectors"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ connectors: [{ id, label: "example" }], hosts: [] });
  fx.connectors.mockRejectedValueOnce(new Error("unavailable"));
  fx.hosts.mockResolvedValueOnce([]);
  expect((await GET(new Request("http://localhost/api/connectors"))).status).toBe(503);
});
