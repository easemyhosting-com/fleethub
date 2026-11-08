/**
 * Measured usage from any Prometheus-compatible API (Prometheus, Mimir, Grafana Cloud, VictoriaMetrics, or Grafana's datasource proxy).
 * The queries use metrics every common exporter already publishes: kube-state-metrics, cAdvisor (Docker and Kubernetes) and node_exporter.
 */
import { addressKind, hostKey } from "@/lib/capacity/addresses";

export interface PromSample { labels: Record<string, string>; value: number }
export const usageQueries = {
  cpuCoresByNamespace: 'sum by (instance, namespace) (max by (instance, namespace, pod, container) (rate(container_cpu_usage_seconds_total{container!="",container!="POD"}[15m])))',
  memBytesByNamespace: 'sum by (instance, namespace) (max by (instance, namespace, pod, container) (container_memory_working_set_bytes{container!="",container!="POD"}))',
  cpuCoresByComposeProject: 'sum by (instance, container_label_com_docker_compose_project) (rate(container_cpu_usage_seconds_total{container_label_com_docker_compose_project!=""}[15m]))',
  memBytesByComposeProject: 'sum by (instance, container_label_com_docker_compose_project) (container_memory_working_set_bytes{container_label_com_docker_compose_project!=""})',
  // Two scrape jobs can publish the same node; collapse by the physical identity (cpu, mode) before summing so a machine is never counted twice.
  nodeCpuBusyCores: 'sum by (instance) (max by (instance, cpu, mode) (rate(node_cpu_seconds_total{mode!="idle"}[15m])))',
  nodeMemUsedBytes: 'max by (instance) (node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)',
  nodeMemTotalBytes: 'max by (instance) (node_memory_MemTotal_bytes)',
  nodeCpuCores: 'count by (instance) (max by (instance, cpu) (node_cpu_seconds_total{mode="idle"}))',
  nodeNames: 'node_uname_info',
  // Plain Docker hosts. Where cAdvisor cannot name containers (containerd image store), a textfile exporter that publishes <host>_docker_container_* by container name is used instead; docker's CPU percent is 100 per core.
  // Both sides of `or` carry exactly (instance, name), so a textfile reading wins and cAdvisor fills in only names the textfile does not publish.
  cpuCoresByContainer: 'max by (instance, name) (label_replace({__name__=~".+_docker_container_cpu_usage_percent"}, "name", "$1", "container", "(.+)")) / 100 or sum by (instance, name) (rate(container_cpu_usage_seconds_total{name!="",namespace="",pod="",container_label_com_docker_compose_project=""}[15m]))',
  memBytesByContainer: 'max by (instance, name) (label_replace({__name__=~".+_docker_container_memory_usage_bytes"}, "name", "$1", "container", "(.+)")) or sum by (instance, name) (container_memory_working_set_bytes{name!="",namespace="",pod="",container_label_com_docker_compose_project=""})',
} as const;
export type UsageQueryName = keyof typeof usageQueries;

/** Prometheus instant-query result -> samples; anything malformed is dropped, never coerced. */
export function samplesFrom(result: unknown): PromSample[] {
  const rows = (result as any)?.data?.result;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: any) => {
    const value = Number(Array.isArray(row?.value) ? row.value[1] : NaN);
    return row?.metric && typeof row.metric === "object" && Number.isFinite(value) ? [{ labels: row.metric as Record<string, string>, value }] : [];
  });
}

export interface ScopeUsage { scope: string; instance: string; kind: "namespace" | "compose"; cpuCores: number | null; memMi: number | null }
/** Keep the exporter instance on every scope. Equal namespace names on two clusters are separate readings. */
export function joinUsage(cpu: PromSample[], mem: PromSample[], label: "namespace" | "container_label_com_docker_compose_project"): ScopeUsage[] {
  const out = new Map<string, ScopeUsage>();
  const entry = (sample: PromSample) => {
    const scope = sample.labels[label], instance = sample.labels.instance ?? "";
    if (!scope) return null;
    const key = JSON.stringify([instance, scope]);
    const row = out.get(key) ?? { scope, instance, kind: label === "namespace" ? "namespace" : "compose", cpuCores: null, memMi: null } satisfies ScopeUsage;
    out.set(key, row);
    return row;
  };
  for (const sample of cpu) { const row = entry(sample); if (row) row.cpuCores = Math.round(sample.value * 1000) / 1000; }
  for (const sample of mem) { const row = entry(sample); if (row) row.memMi = Math.round(sample.value / 1048576); }
  return [...out.values()].sort((a, b) => a.scope.localeCompare(b.scope) || a.instance.localeCompare(b.instance));
}

export interface ScopedPlacement { projectId: string; hostName: string; resourceId: string | null; runtime: string; scope: string }
export interface ScopeTotal { projectId: string; hostName: string; resourceId: string | null; kind: ScopeUsage["kind"]; scopes: string[]; cpuCores: number | null; memMi: number | null }

/** Resolve exporter ports through node_exporter names. Conflicting names or normalized names never select a host by guess. */
export function metricMachine(instance: string, hosts: HostCapacity[]): string | null {
  const bare = instance.replace(/:\d+$/, "");
  if (!bare) return null;
  const candidates = new Set(hosts.filter(host => host.instance.replace(/:\d+$/, "") === bare).map(measuredHostName));
  if (candidates.size > 1) return null;
  return hostKey([...candidates][0] ?? bare);
}

/** Only one project on one machine can own a namespace/Compose total. Shared scopes are omitted rather than counted once per project. */
export function attributeScopes(usage: ScopeUsage[], placements: ScopedPlacement[], hosts: HostCapacity[] = []): ScopeTotal[] {
  const totals = new Map<string, ScopeTotal>();
  const missingCpu = new Set<string>(), missingMem = new Set<string>();
  const collisions = new Map<string, Set<string>>();
  for (const p of placements) {
    const key = hostKey(p.hostName), names = collisions.get(key) ?? new Set<string>();
    names.add(p.hostName); collisions.set(key, names);
  }
  const counts = new Map<string, number>();
  for (const item of usage) {
    const key = JSON.stringify([metricMachine(item.instance, hosts), item.kind, item.scope]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const item of usage) {
    const machine = metricMachine(item.instance, hosts);
    if (!machine || (collisions.get(machine)?.size ?? 0) > 1 || counts.get(JSON.stringify([machine, item.kind, item.scope])) !== 1) continue;
    const matches = placements.filter(p => hostKey(p.hostName) === machine && p.scope.split(",").includes(item.scope) &&
      (item.kind === "namespace" ? ["k8s", "flux"].includes(p.runtime) : ["docker", "compose"].includes(p.runtime)));
    if (matches.length !== 1) continue;
    const p = matches[0], key = JSON.stringify([p.projectId, machine, item.kind]);
    const entry = totals.get(key) ?? { projectId: p.projectId, hostName: p.hostName, resourceId: p.resourceId, kind: item.kind, scopes: [], cpuCores: null, memMi: null };
    entry.scopes.push(item.scope);
    if (item.cpuCores === null) missingCpu.add(key);
    if (item.memMi === null) missingMem.add(key);
    if (item.cpuCores !== null) entry.cpuCores = Math.round(((entry.cpuCores ?? 0) + item.cpuCores) * 1000) / 1000;
    if (item.memMi !== null) entry.memMi = (entry.memMi ?? 0) + item.memMi;
    totals.set(key, entry);
  }
  return [...totals].map(([key, total]) => ({ ...total, cpuCores: missingCpu.has(key) ? null : total.cpuCores, memMi: missingMem.has(key) ? null : total.memMi }));
}

export interface HostCapacity { instance: string; nodeName: string | null; cpuCores: number | null; cpuBusyCores: number | null; memTotalMi: number | null; memUsedMi: number | null }
/** Whole-machine numbers from node_exporter: the denominator for "how full is this host". */
export function joinHosts(parts: { cores: PromSample[]; busy: PromSample[]; total: PromSample[]; used: PromSample[]; names?: PromSample[] }): HostCapacity[] {
  const out = new Map<string, HostCapacity>();
  const row = (instance: string) => out.get(instance) ?? { instance, nodeName: null, cpuCores: null, cpuBusyCores: null, memTotalMi: null, memUsedMi: null };
  for (const s of parts.cores) { const r = row(s.labels.instance ?? ""); r.cpuCores = s.value; out.set(r.instance, r); }
  for (const s of parts.busy) { const r = row(s.labels.instance ?? ""); r.cpuBusyCores = Math.round(s.value * 1000) / 1000; out.set(r.instance, r); }
  for (const s of parts.total) { const r = row(s.labels.instance ?? ""); r.memTotalMi = Math.round(s.value / 1048576); out.set(r.instance, r); }
  for (const s of parts.used) { const r = row(s.labels.instance ?? ""); r.memUsedMi = Math.round(s.value / 1048576); out.set(r.instance, r); }
  for (const s of parts.names ?? []) { const name = s.labels.nodename; if (!name || !out.has(s.labels.instance ?? "")) continue; out.get(s.labels.instance)!.nodeName = name; }
  return [...out.values()].filter(item => item.instance).sort((a, b) => a.instance.localeCompare(b.instance));
}

/** The machine a node_exporter instance stands for: an IP instance is named by its node name; a named instance (atlas, whose nodename is a container id) keeps its own name. */
export function measuredHostName(host: Pick<HostCapacity, "instance" | "nodeName">): string {
  const bare = host.instance.replace(/:\d+$/, "");
  return addressKind(bare) ? (host.nodeName ?? bare) : bare;
}

export interface ContainerUsage { instance: string; name: string; cpuCores: number | null; memMi: number | null }
/** Plain Docker containers (no Compose label, not Kubernetes) by name and machine; matched to projects by name rule, never by guess. */
export function joinContainers(cpu: PromSample[], mem: PromSample[]): ContainerUsage[] {
  const out = new Map<string, ContainerUsage>();
  const row = (s: PromSample) => out.get(`${s.labels.instance}|${s.labels.name}`) ?? { instance: s.labels.instance ?? "", name: s.labels.name ?? "", cpuCores: null, memMi: null };
  for (const s of cpu) { if (!s.labels.name) continue; const r = row(s); r.cpuCores = Math.round(s.value * 1000) / 1000; out.set(`${r.instance}|${r.name}`, r); }
  for (const s of mem) { if (!s.labels.name) continue; const r = row(s); r.memMi = Math.round(s.value / 1048576); out.set(`${r.instance}|${r.name}`, r); }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface PlacedContainerHost { projectId: string; hostName: string; resourceId: string | null; slug: string }
export interface ContainerTotal { projectId: string; hostName: string; resourceId: string | null; cpuCores: number | null; memMi: number | null; containers: string[] }
/** Sums container usage per project and machine. A container instance is resolved to its machine first (port stripped, IP mapped through the node name), so one project on two hosts stays two rows. */
export function attributeContainers(containers: ContainerUsage[], placements: PlacedContainerHost[], hosts: HostCapacity[] = []): ContainerTotal[] {
  const totals = new Map<string, ContainerTotal>();
  const missingCpu = new Set<string>(), missingMem = new Set<string>();
  const names = new Map<string, Set<string>>();
  for (const p of placements) { const key = hostKey(p.hostName), values = names.get(key) ?? new Set<string>(); values.add(p.hostName); names.set(key, values); }
  for (const container of containers) {
    const machine = metricMachine(container.instance, hosts);
    if (!machine || (names.get(machine)?.size ?? 0) > 1) continue;
    const matches = placements.filter(p => hostKey(p.hostName) === machine && containerBelongs(container.name, p.slug));
    if (matches.length !== 1) continue;
    const p = matches[0], id = `${p.projectId}|${machine}`;
    const entry = totals.get(id) ?? { projectId: p.projectId, hostName: p.hostName, resourceId: p.resourceId, cpuCores: null, memMi: null, containers: [] };
    if (container.cpuCores === null) missingCpu.add(id);
    else entry.cpuCores = Math.round(((entry.cpuCores ?? 0) + container.cpuCores) * 1000) / 1000;
    if (container.memMi === null) missingMem.add(id);
    else entry.memMi = (entry.memMi ?? 0) + container.memMi;
    entry.containers.push(container.name); totals.set(id, entry);
  }
  return [...totals].map(([key, total]) => ({ ...total, cpuCores: missingCpu.has(key) ? null : total.cpuCores, memMi: missingMem.has(key) ? null : total.memMi }));
}

/** A container belongs to a project when its name is the project slug or starts with the slug and a dash (kanban-oauth2 -> kanban). */
export function containerBelongs(containerName: string, slug: string): boolean {
  const name = containerName.replace(/^\//, "").toLowerCase(), key = slug.toLowerCase();
  return name === key || name.startsWith(`${key}-`);
}
