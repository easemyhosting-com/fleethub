import { beforeEach, expect, it, vi } from "vitest";
const fx = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ queryClient: fx.query }));
import { readProjectMeasurements } from "../src/lib/projects/measurements";
beforeEach(() => fx.query.mockReset());
it("returns no reports without project ids", async () => {
  expect(await readProjectMeasurements([])).toEqual([]); expect(fx.query).not.toHaveBeenCalled();
});
it("keeps source and attribution with nullable CPU and marks old readings stale", async () => {
  fx.query.mockResolvedValue([
    { project_id: "p", resource_ref: "host:a", metrics: { source: "prometheus", kind: "containers", cpuCores: 0.1, memMi: 80, containers: ["api"] }, received_at: new Date() },
    { project_id: "p", resource_ref: "host:b", metrics: { source: "prometheus", kind: "namespace", scopes: ["db"] }, received_at: new Date(Date.now() - 2 * 3600000) },
    { project_id: "p", resource_ref: "host:c", metrics: { cpuCores: 99 }, received_at: new Date() },
    { project_id: "p", resource_ref: "host:d", metrics: { source: "prometheus", kind: "compose" }, received_at: new Date(Date.now() - 25 * 3600000) },
  ]);
  const rows = await readProjectMeasurements(["p"]);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ hostRef: "host:a", kind: "containers", cpuCores: 0.1, memMi: 80, stale: false, containers: ["api"] });
  expect(rows[1]).toMatchObject({ hostRef: "host:b", kind: "namespace", cpuCores: null, memMi: null, stale: true, scopes: ["db"] });
});
