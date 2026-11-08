/**
 * Oracle Cloud Infrastructure (OCI) Compute & Resource Connector
 * Retrieves real compute instances, shapes, OCPUs, memory, and status across tenancies.
 * Uses local OCI config profiles (default, secondary, sandbox) or Infisical credentials.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execFileAsync = promisify(execFile);

export interface OciInstance {
  id: string;
  name: string;
  state: "RUNNING" | "STOPPED" | "STARTING" | "STOPPING" | "TERMINATED" | "UNKNOWN";
  shape: string;
  processor: string;
  ocpus: number;
  memoryGb: number;
  region: string;
  timeCreated: string;
  tenancyProfile: string;
  isProtected: boolean;
  role: string;
}

export interface OciTenancySummary {
  profile: string;
  tenancyId?: string;
  instances: OciInstance[];
  totalOcpus: number;
  totalMemoryGb: number;
  activeCount: number;
}

export interface OciFleetReport {
  connected: boolean;
  dataSource: "live_cli" | "offline_snapshot";
  observationTime: string;
  totalInstances: number;
  runningInstances: number;
  totalOcpusAllocated: number;
  totalMemoryAllocatedGb: number;
  ampereA1Instances: number;
  amdInstances: number;
  instances: OciInstance[];
  lastPolledAt: string;
}

// Demo snapshot with fictional hosts, used only in demo mode and tests when the OCI CLI is unavailable
const KNOWN_OCI_FLEET: OciInstance[] = [
  {
    id: "ocid1.instance.oc1.ap-mumbai-1.demo-instance-atlas-flex-a1-01",
    name: "Atlas",
    state: "RUNNING",
    shape: "VM.Standard.A1.Flex",
    processor: "3.0 GHz Ampere® Altra™",
    ocpus: 2.0,
    memoryGb: 12.0,
    region: "ap-mumbai-1",
    timeCreated: "2026-01-01T00:00:00.000000+00:00",
    tenancyProfile: "default",
    isProtected: true,
    role: "Docker host (AI gateway and internal services)",
  },
  {
    id: "ocid1.instance.oc1.ap-mumbai-1.demo-instance-night-flex-a1-02",
    name: "polar_night_owl",
    state: "RUNNING",
    shape: "VM.Standard.A1.Flex",
    processor: "3.0 GHz Ampere® Altra™",
    ocpus: 2.0,
    memoryGb: 12.0,
    region: "ap-mumbai-1",
    timeCreated: "2026-01-02T00:00:00.000000+00:00",
    tenancyProfile: "secondary",
    isProtected: true,
    role: "K3s cluster 2 (production workloads)",
  },
  {
    id: "ocid1.instance.oc1.ap-mumbai-1.demo-instance-borealis-flex-a1-03",
    name: "borealis",
    state: "RUNNING",
    shape: "VM.Standard.A1.Flex",
    processor: "3.0 GHz Ampere® Altra™",
    ocpus: 2.0,
    memoryGb: 12.0,
    region: "ap-mumbai-1",
    timeCreated: "2026-01-03T00:00:00.000000+00:00",
    tenancyProfile: "secondary",
    isProtected: true,
    role: "K3s Cluster 1 (Core Services & Ingress Controller)",
  },
  {
    id: "ocid1.instance.oc1.ap-mumbai-1.demo-instance-ember-micro-04",
    name: "polar_ember",
    state: "STOPPED",
    shape: "VM.Standard.E2.1.Micro",
    processor: "2.0 GHz AMD EPYC™ 7551 (Naples)",
    ocpus: 1.0,
    memoryGb: 1.0,
    region: "ap-mumbai-1",
    timeCreated: "2026-01-04T00:00:00.000000+00:00",
    tenancyProfile: "sandbox",
    isProtected: true,
    role: "Always Free AMD Micro Instance (Cold Standby)",
  },
];

export function getOciCompartments(config: string): Array<{ profile: string; compartmentId: string }> {
  const sections = config.split(/^\s*\[([^\]\r\n]+)\]\s*$/m);
  const result: Array<{ profile: string; compartmentId: string }> = [];
  for (let index = 1; index < sections.length; index += 2) {
    const profile = sections[index].trim();
    if (!["DEFAULT", "default", "secondary", "sandbox"].includes(profile)) continue;
    const compartmentId = sections[index + 1]?.match(/^\s*compartment_id\s*=\s*([^\r\n]+)/m)?.[1]?.trim();
    if (compartmentId && /^[a-zA-Z0-9._-]+$/.test(compartmentId)) result.push({ profile, compartmentId });
  }
  return result;
}

export async function getOciFleetResources(): Promise<OciFleetReport> {
  const ociConfigPath = path.join(process.env.HOME || "/root", ".oci", "config");
  const hasLocalConfig = fs.existsSync(ociConfigPath);

  let instances: OciInstance[] = [];

  if (hasLocalConfig) {
    try {
      const configContent = fs.readFileSync(ociConfigPath, "utf-8");
      const profiles = getOciCompartments(configContent);

      await Promise.all(
        profiles.map(async ({ profile, compartmentId }) => {

          try {
            const { stdout } = await execFileAsync(
              "oci",
              [
                "compute",
                "instance",
                "list",
                "--profile",
                profile,
                "--compartment-id",
                compartmentId,
                "--output",
                "json",
              ],
              { timeout: 3500 }
            );

            const parsed = JSON.parse(stdout);
            const rawInstances = parsed.data || [];

            for (const item of rawInstances) {
              const sc = item["shape-config"] || {};
              const shape = item["shape"] || "VM.Standard.A1.Flex";
              const name = item["display-name"] || "OCI Instance";
              const isA1 = shape.includes("A1");

              instances.push({
                id: item["id"],
                name,
                state: item["lifecycle-state"] || "UNKNOWN",
                shape,
                processor: sc["processor-description"] || (isA1 ? "3.0 GHz Ampere® Altra™" : "AMD EPYC™"),
                ocpus: Number(sc["ocpus"] || (isA1 ? 2 : 1)),
                memoryGb: Number(sc["memory-in-gbs"] || (isA1 ? 12 : 1)),
                region: item["region"] || "ap-mumbai-1",
                timeCreated: item["time-created"] || new Date().toISOString(),
                tenancyProfile: profile,
                isProtected: true,
                role: name.toLowerCase().includes("atlas")
                  ? "Docker Brain"
                  : name.toLowerCase().includes("borealis")
                  ? "K3s Cluster 1"
                  : name.toLowerCase().includes("night")
                  ? "K3s Cluster 2"
                  : "Free Compute Node",
              });
            }
          } catch {
            // Fall back gracefully for any individual profile error
          }
        })
      );
    } catch (e) {
      console.warn("[OCI] CLI discovery error; no instances discovered:", e);
    }
  }

  const isLive = instances.length > 0;

  // If local CLI was unavailable, fallback to baseline snapshot only in demo mode or tests
  if (!isLive && (process.env.FLEETHUB_DEMO_MODE === "true" || process.env.NODE_ENV === "test")) {
    instances = KNOWN_OCI_FLEET;
  }

  const running = instances.filter((i) => i.state === "RUNNING");
  const totalOcpus = instances.reduce((acc, i) => acc + (i.state === "RUNNING" ? i.ocpus : 0), 0);
  const totalMemory = instances.reduce((acc, i) => acc + (i.state === "RUNNING" ? i.memoryGb : 0), 0);
  const ampereCount = instances.filter((i) => i.shape.includes("A1")).length;
  const amdCount = instances.filter((i) => !i.shape.includes("A1")).length;

  return {
    connected: isLive,
    dataSource: isLive ? "live_cli" : "offline_snapshot",
    observationTime: isLive ? new Date().toISOString() : "2026-07-20T12:00:00Z",
    totalInstances: instances.length,
    runningInstances: running.length,
    totalOcpusAllocated: totalOcpus,
    totalMemoryAllocatedGb: totalMemory,
    ampereA1Instances: ampereCount,
    amdInstances: amdCount,
    instances,
    lastPolledAt: new Date().toISOString(),
  };
}
