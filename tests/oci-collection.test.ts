import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promisify } from "node:util";

const fixture = vi.hoisted(() => ({ failRead: false, failCli: false, data: [] as Record<string, unknown>[] }));
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { default: { ...actual, existsSync: () => true, readFileSync: () => {
    if (fixture.failRead) throw new Error("fixture config unreadable");
    return "[DEFAULT]\ncompartment_id=ocid1.fixture\n";
  } } };
});
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const execute = Object.assign(vi.fn(), { [promisify.custom]: async () => {
    if (fixture.failCli) throw new Error("fixture CLI unavailable");
    return { stdout: JSON.stringify({ data: fixture.data }) };
  } });
  return { ...actual, execFile: execute };
});

import { getOciFleetResources } from "../src/lib/providers/oci";

describe("OCI discovery through a simulated CLI boundary", () => {
  beforeEach(() => { fixture.failRead = false; fixture.failCli = false; fixture.data = []; });
  afterEach(() => vi.unstubAllEnvs());

  it("normalizes actual CLI-shaped records without executing a remote operation", async () => {
    fixture.data = ["atlas", "borealis", "night", "other"].map((name, index) => ({
      id: `ocid1.fixture.${index}`, "display-name": name, "lifecycle-state": "RUNNING",
      shape: index === 3 ? "VM.Standard.E2.1.Micro" : "VM.Standard.A1.Flex",
      "shape-config": { ocpus: 2, "memory-in-gbs": 8, "processor-description": "Fixture CPU" },
      region: "fixture-region", "time-created": "2026-01-01T00:00:00Z",
    }));
    const report = await getOciFleetResources();
    expect(report.dataSource).toBe("live_cli");
    expect(report.runningInstances).toBe(4);
    expect(report.totalOcpusAllocated).toBe(8);
    expect(report.totalMemoryAllocatedGb).toBe(32);
    expect(report.instances.map(item => item.role)).toEqual(["Docker Brain", "K3s Cluster 1", "K3s Cluster 2", "Free Compute Node"]);
  });

  it("handles missing optional fields and unavailable config or CLI without inventing live status", async () => {
    fixture.data = [{ id: "ocid1.fixture", shape: "VM.Standard.E2.1.Micro" }, { id: "ocid1.arm" }];
    const report = await getOciFleetResources();
    expect(report.instances[0]).toMatchObject({ name: "OCI Instance", state: "UNKNOWN", ocpus: 1, memoryGb: 1 });
    expect(report.instances[1]).toMatchObject({ ocpus: 2, memoryGb: 12 });
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FLEETHUB_DEMO_MODE", "false");
    fixture.failCli = true;
    expect((await getOciFleetResources()).connected).toBe(false);
    fixture.failRead = true;
    expect((await getOciFleetResources()).instances).toEqual([]);
  });
});
