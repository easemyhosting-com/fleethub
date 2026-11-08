import type { ProjectMeasurement } from "@/lib/projects/measurements";
import { cpuMilli, memMi } from "@/lib/gitops/discover";

/** Kept free for the OS, k3s or Docker daemon and burst. Planning numbers, not measurements; shown to the user and easy to change here. */
export const reserve = { cpuFraction: 0.1, memMi: 1024 } as const;

export interface HostInput { id: string; name: string; state: string; region: string | null; specs: { ocpus?: number; memoryGb?: number; shape?: string; arch?: string } }
export interface PlacementInput { projectId: string; slug: string; name: string; kind: string; runtime: string; declared: { cpuRequestMilli?: number; cpuLimitMilli?: number; memRequestMi?: number; memLimitMi?: number; pvcGi?: number; replicas?: number | null } }
export interface ProjectLoad { projectId: string; slug: string; name: string; kind: string; runtime: string; cpuRequestMilli: number; memRequestMi: number; cpuLimitMilli: number; memLimitMi: number; pvcGi: number; declaresRequests: boolean; measuredUsage: ProjectMeasurement[] }
export type HostStatus = "ok" | "tight" | "over" | "unknown_size" | "no_data";
export interface HostCapacity {
  hostId: string; name: string; state: string; region: string | null; shape: string | null;
  totalCpuMilli: number | null; totalMemMi: number | null;
  requestedCpuMilli: number; requestedMemMi: number; limitCpuMilli: number; limitMemMi: number; pvcGi: number;
  freeCpuMilli: number | null; freeMemMi: number | null;
  cpuRequestPct: number | null; memRequestPct: number | null; cpuLimitPct: number | null; memLimitPct: number | null;
  status: HostStatus; projects: ProjectLoad[]; withoutRequests: string[];
  basis: "declared_requests"; measured: false; reserve: { cpuMilli: number | null; memMi: number };
  /** Whole-machine numbers from a connected metrics source, when one exists. Separate from the declared figures above. */
  measuredUsage: MeasuredUsage | null;
  addresses: HostAddress[];
}
export interface MeasuredUsage { instance: string; cpuCores: number | null; cpuBusyCores: number | null; memTotalMi: number | null; memUsedMi: number | null; measuredAt: string; stale: boolean }

/** A reading older than an hour is shown as stale, never as "now"; one older than a day is not shown at all. */
export const measuredFreshMs = 60 * 60 * 1000, measuredMaxAgeMs = 24 * 60 * 60 * 1000;
export function measurementFreshness(measuredAt: Date, now: Date = new Date()): "fresh" | "stale" | "expired" {
  const age = now.getTime() - measuredAt.getTime();
  return age > measuredMaxAgeMs ? "expired" : age > measuredFreshMs ? "stale" : "fresh";
}
export interface HostAddress { address: string; kind: "tailscale" | "private" | "public"; source: string }

const pct = (used: number, total: number | null) => total && total > 0 ? Math.round((used / total) * 1000) / 10 : null;

/** What is spoken for on one host: the sum of declared requests (what the scheduler reserves), with limits as overcommit risk. Declared, not measured. */
export function hostCapacity(host: HostInput, placements: PlacementInput[]): HostCapacity {
  const totalCpu = host.specs.ocpus ? Math.round(host.specs.ocpus * 1000) : null;
  const totalMem = host.specs.memoryGb ? Math.round(host.specs.memoryGb * 1024) : null;
  const projects: ProjectLoad[] = placements.map(p => ({
    projectId: p.projectId, slug: p.slug, name: p.name, kind: p.kind, runtime: p.runtime,
    cpuRequestMilli: Math.round(p.declared.cpuRequestMilli ?? 0), memRequestMi: Math.round(p.declared.memRequestMi ?? 0),
    cpuLimitMilli: Math.round(p.declared.cpuLimitMilli ?? 0), memLimitMi: Math.round(p.declared.memLimitMi ?? 0), pvcGi: Math.round((p.declared.pvcGi ?? 0) * 10) / 10,
    measuredUsage: [],
    declaresRequests: (p.declared.cpuRequestMilli ?? 0) > 0 || (p.declared.memRequestMi ?? 0) > 0,
  })).sort((a, b) => b.cpuRequestMilli - a.cpuRequestMilli || a.slug.localeCompare(b.slug));
  const sum = (key: keyof Pick<ProjectLoad, "cpuRequestMilli" | "memRequestMi" | "cpuLimitMilli" | "memLimitMi" | "pvcGi">) => projects.reduce((total, p) => total + p[key], 0);
  const requestedCpu = sum("cpuRequestMilli"), requestedMem = sum("memRequestMi");
  const reservedCpu = totalCpu === null ? null : Math.round(totalCpu * reserve.cpuFraction);
  const freeCpu = totalCpu === null ? null : totalCpu - (reservedCpu ?? 0) - requestedCpu;
  const freeMem = totalMem === null ? null : totalMem - reserve.memMi - requestedMem;
  const cpuPct = pct(requestedCpu, totalCpu), memPct = pct(requestedMem, totalMem);
  const status: HostStatus = totalCpu === null || totalMem === null ? "unknown_size" : projects.length === 0 ? "no_data" : freeCpu! < 0 || freeMem! < 0 ? "over" : freeCpu! <= totalCpu * 0.2 || freeMem! <= totalMem * 0.2 ? "tight" : "ok";
  return {
    hostId: host.id, name: host.name, state: host.state, region: host.region, shape: host.specs.shape ?? null,
    totalCpuMilli: totalCpu, totalMemMi: totalMem, requestedCpuMilli: requestedCpu, requestedMemMi: requestedMem, limitCpuMilli: sum("cpuLimitMilli"), limitMemMi: sum("memLimitMi"), pvcGi: Math.round(sum("pvcGi") * 10) / 10,
    freeCpuMilli: freeCpu, freeMemMi: freeMem, cpuRequestPct: cpuPct, memRequestPct: memPct, cpuLimitPct: pct(sum("cpuLimitMilli"), totalCpu), memLimitPct: pct(sum("memLimitMi"), totalMem),
    status, projects, withoutRequests: projects.filter(p => !p.declaresRequests).map(p => p.slug),
    basis: "declared_requests", measured: false, reserve: { cpuMilli: reservedCpu, memMi: reserve.memMi },
    measuredUsage: null, addresses: [],
  };
}

export interface Ask { cpuMilli: number; memMi: number }
export interface FitResult { hostId: string; name: string; fits: boolean | null; reason: string; remainingCpuMilli: number | null; remainingMemMi: number | null }

/** Does an ask fit after the reserve? Null when the host size or its load is unknown; never a guess. Offline hosts do not fit. */
export function fit(capacity: HostCapacity, ask: Ask): FitResult {
  const base = { hostId: capacity.hostId, name: capacity.name };
  if (capacity.freeCpuMilli === null || capacity.freeMemMi === null) return { ...base, fits: null, reason: "Host size is not known, so fit cannot be judged.", remainingCpuMilli: null, remainingMemMi: null };
  if (capacity.status === "no_data") return { ...base, fits: null, reason: "No workloads are registered for this host, so its load is unknown. Connect it (cluster, Docker or metrics) before trusting a fit.", remainingCpuMilli: null, remainingMemMi: null };
  const remainingCpu = capacity.freeCpuMilli - ask.cpuMilli, remainingMem = capacity.freeMemMi - ask.memMi;
  if (capacity.state !== "online") return { ...base, fits: false, reason: `Host is ${capacity.state}.`, remainingCpuMilli: remainingCpu, remainingMemMi: remainingMem };
  const problems = [remainingCpu < 0 && `${-remainingCpu}m CPU short`, remainingMem < 0 && `${-remainingMem} MiB memory short`].filter(Boolean);
  return { ...base, fits: problems.length === 0, reason: problems.length ? `Does not fit: ${problems.join(", ")} after reserving ${Math.round(reserve.cpuFraction * 100)}% CPU and ${reserve.memMi} MiB.` : "Fits within declared requests after the reserve. Actual load is not measured.", remainingCpuMilli: remainingCpu, remainingMemMi: remainingMem };
}

export function parseAsk(cpu: string | null, memory: string | null): Ask | null {
  const c = cpu ? cpuMilli(cpu) : 0, m = memory ? memMi(memory) : 0;
  return (cpu && !c) || (memory && !m) || (!cpu && !memory) ? null : { cpuMilli: c, memMi: m };
}
