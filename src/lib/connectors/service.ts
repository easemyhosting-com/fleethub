import { randomUUID } from "node:crypto";
import { queryClient } from "@/lib/db/client";
import { builtinVaultUrl, createBuiltinVault } from "@/lib/vault/builtin";
import { configSchemas, writeScope } from "@/lib/onboarding/model";
import { refreshStaleVaultSteps } from "@/lib/onboarding/service";
import { vaultSession } from "@/lib/onboarding/vault";
import { openVaultForRef, type VaultRef } from "@/lib/onboarding/vault-ref";
import { applyProposal, type ApplySummary } from "@/lib/gitops/register";
import type { Discovery } from "@/lib/gitops/discover";
import { ConnectorError, fetchClusterSnapshot, fetchDockerSnapshot, queryPrometheus, type ConnectorConfig } from "./clients";
import { normalizeCluster } from "./kubernetes";
import { normalizeDocker } from "./docker";
import { attributeContainers, attributeScopes, joinContainers, joinHosts, joinUsage, measuredHostName, type ContainerUsage, type HostCapacity, type ScopeUsage } from "./prometheus";
import { addressKind, hostKey } from "@/lib/capacity/addresses";
import { resolveConnectorHost } from "./hosts";
import { effectiveScanInterval } from "./schedule-rules";

export class UnknownConnector extends Error {}
export class SecretStoreNotReady extends Error {}

/**
 * Same rule as provider accounts: Infisical when its setup step is verified, otherwise the built-in encrypted store.
 * The location is recorded in secret_refs (never the value), so reads follow whichever backend actually holds it.
 */
export async function createConnector(config: ConnectorConfig, secret: string | undefined, by: string): Promise<{ id: string; store: "infisical" | "builtin" | "none" }> {
  if (config.kind !== "prometheus") config = { ...config, hostName: resolveConnectorHost(config.hostName, await listConnectorHosts()) };
  const id = `conn-${randomUUID()}`;
  const { caPem, ...rest } = config;
  let refId: string | null = null; let secretName: string | null = null; let store: "infisical" | "builtin" | "none" = "none";
  if (secret) {
    const state = await refreshStaleVaultSteps();
    if (!state.ready) throw new SecretStoreNotReady();
    const infisical = state.steps.find(step => step.id === "infisical");
    const useInfisical = infisical?.status === "verified";
    const scope = useInfisical ? writeScope(configSchemas.infisical.parse(infisical?.config), "connector") : { apiUrl: builtinVaultUrl, projectId: "builtin", environment: "builtin", secretPath: "/" };
    const vault = useInfisical ? await vaultSession(scope as Parameters<typeof vaultSession>[0]) : createBuiltinVault();
    secretName = `FLEETHUB_CONNECTOR_${randomUUID().replaceAll("-", "")}`;
    refId = `ref-${randomUUID()}`;
    await vault.write(secretName, secret);
    try {
      if (await vault.read(secretName) !== secret) throw new Error("Credential persistence could not be verified");
      await queryClient`INSERT INTO secret_refs (id, label, vault_url, infisical_project, environment, path, keys, status, last_verified_at)
        VALUES (${refId}, ${`${config.kind} connector credential`}, ${scope.apiUrl}, ${scope.projectId}, ${scope.environment}, ${scope.secretPath}, ${JSON.stringify([secretName])}, 'verified', NOW())`;
      await queryClient`INSERT INTO connectors (id, kind, label, host_name, config, secret_name, secret_ref_id, created_by) VALUES (${id}, ${config.kind}, ${config.label}, ${config.hostName}, ${JSON.stringify({ ...rest, caPem: caPem ?? "" })}, ${secretName}, ${refId}, ${by})`;
    } catch (error) { await vault.remove(secretName).catch(() => undefined); throw error; }
    store = useInfisical ? "infisical" : "builtin";
  } else {
    await queryClient`INSERT INTO connectors (id, kind, label, host_name, config, created_by) VALUES (${id}, ${config.kind}, ${config.label}, ${config.hostName}, ${JSON.stringify({ ...rest, caPem: caPem ?? "" })}, ${by})`;
  }
  return { id, store };
}

async function readConnectorSecret(row: { secret_ref_id?: unknown }): Promise<string | undefined> {
  if (!row.secret_ref_id) return undefined;
  const [ref] = await queryClient`SELECT r.vault_url, r.infisical_project, r.environment, r.path, r.keys, s.config AS current_config FROM secret_refs r LEFT JOIN onboarding_steps s ON s.id = 'infisical' WHERE r.id = ${String(row.secret_ref_id)}`;
  if (!ref || !Array.isArray(ref.keys) || typeof ref.keys[0] !== "string") throw new ConnectorError("unauthorized");
  return (await openVaultForRef(ref as unknown as VaultRef, ref.current_config)).read(ref.keys[0]);
}

export async function listConnectorHosts(): Promise<Array<{ id: string; name: string }>> {
  const rows = await queryClient`SELECT r.id, r.name FROM resources r LEFT JOIN provider_accounts a ON a.id = r.account_id
    WHERE r.category = 'compute' AND r.retired_at IS NULL AND r.state <> 'missing' AND (a.id IS NULL OR a.archived_at IS NULL) ORDER BY r.name`;
  return rows.map(row => ({ id: String(row.id), name: String(row.name) }));
}

export async function listConnectors() {
  const rows = await queryClient`SELECT id, kind, label, host_name, config, last_scan_at, last_status, last_summary, created_at, scan_interval_minutes, scan_requested_at, rescan_key_hash FROM connectors ORDER BY created_at DESC LIMIT 100`;
  return rows.map(row => ({
    id: String(row.id), kind: String(row.kind), label: String(row.label), hostName: String(row.host_name), url: String((row.config as { url?: string }).url ?? ""),
    allowHttp: Boolean((row.config as { allowHttp?: boolean }).allowHttp), hasCa: Boolean((row.config as { caPem?: string }).caPem),
    lastScanAt: row.last_scan_at ? new Date(row.last_scan_at).toISOString() : null, lastStatus: row.last_status as string | null, lastSummary: row.last_summary,
    scanIntervalMinutes: effectiveScanInterval(String(row.kind), row.scan_interval_minutes as number | null), scanRequested: Boolean(row.scan_requested_at), hasRescanKey: Boolean(row.rescan_key_hash),
  }));
}

export async function deleteConnector(id: string): Promise<boolean> {
  const [row] = await queryClient`SELECT secret_ref_id FROM connectors WHERE id = ${id}`;
  if (!row) return false;
  if (row.secret_ref_id) {
    const [ref] = await queryClient`SELECT r.vault_url, r.infisical_project, r.environment, r.path, r.keys, s.config AS current_config FROM secret_refs r LEFT JOIN onboarding_steps s ON s.id = 'infisical' WHERE r.id = ${String(row.secret_ref_id)}`;
    try { if (ref?.keys?.[0]) await (await openVaultForRef(ref as unknown as VaultRef, ref.current_config)).remove(ref.keys[0]); } catch { /* the credential may already be gone; the connector is still removed */ }
    await queryClient`DELETE FROM secret_refs WHERE id = ${String(row.secret_ref_id)}`.catch(() => undefined);
  }
  await queryClient`DELETE FROM host_measurements WHERE connector_id = ${id}`;
  await queryClient`DELETE FROM connectors WHERE id = ${id}`;
  return true;
}

export interface ScanResult { kind: string; discovery?: Discovery; usage?: { hosts: HostCapacity[]; namespaces: ScopeUsage[]; composeProjects: ScopeUsage[]; containers: ContainerUsage[] }; applied?: ApplySummary; usageRecorded?: number; unregistered?: string[] }

/**
 * Dry run by default. `apply` registers the selected projects (Kubernetes, Docker) or records measured usage against matching placements (Prometheus).
 * `refreshRegistered` (scheduled scans) updates only projects that are already registered and not archived, and lists the rest for review. Read-only toward the target in every case.
 */
export async function scanConnector(id: string, options: { apply: boolean; select: string[]; refreshRegistered?: boolean }): Promise<ScanResult> {
  const [row] = await queryClient`SELECT id, kind, label, host_name, config, secret_name, secret_ref_id FROM connectors WHERE id = ${id}`;
  if (!row) throw new UnknownConnector();
  const config = { ...(row.config as object), kind: String(row.kind), label: String(row.label), hostName: String(row.host_name) } as ConnectorConfig;
  let result: ScanResult;
  try {
    const secret = await readConnectorSecret(row);
    if (config.kind === "kubernetes") {
      if (!secret) throw new ConnectorError("unauthorized");
      const discovery = normalizeCluster(config.hostName, await fetchClusterSnapshot(config, secret));
      result = { kind: "kubernetes", discovery };
      if (options.apply) result.applied = await applyProposal(discovery, options.select, `kubernetes ${config.label}`);
      else if (options.refreshRegistered) Object.assign(result, await refreshRegistered(discovery, `kubernetes ${config.label}`));
    } else if (config.kind === "docker") {
      const discovery = normalizeDocker(config.hostName, await fetchDockerSnapshot(config, secret));
      result = { kind: "docker", discovery };
      if (options.apply) result.applied = await applyProposal(discovery, options.select, `docker ${config.label}`);
      else if (options.refreshRegistered) Object.assign(result, await refreshRegistered(discovery, `docker ${config.label}`));
    } else {
      const q = await queryPrometheus(config, secret, ["cpuCoresByNamespace", "memBytesByNamespace", "cpuCoresByComposeProject", "memBytesByComposeProject", "nodeCpuCores", "nodeCpuBusyCores", "nodeMemTotalBytes", "nodeMemUsedBytes", "nodeNames", "cpuCoresByContainer", "memBytesByContainer"]);
      const namespaces = joinUsage(q.cpuCoresByNamespace, q.memBytesByNamespace, "namespace");
      const composeProjects = joinUsage(q.cpuCoresByComposeProject, q.memBytesByComposeProject, "container_label_com_docker_compose_project");
      const hosts = joinHosts({ cores: q.nodeCpuCores, busy: q.nodeCpuBusyCores, total: q.nodeMemTotalBytes, used: q.nodeMemUsedBytes, names: q.nodeNames });
      const containers = joinContainers(q.cpuCoresByContainer, q.memBytesByContainer);
      result = { kind: "prometheus", usage: { hosts, namespaces, composeProjects, containers } };
      if (options.apply) {
        result.usageRecorded = await recordMeasuredUsage(String(row.id), [...namespaces, ...composeProjects], containers, hosts);
        await recordHostMeasurements(String(row.id), hosts);
      }
    }
    await queryClient`UPDATE connectors SET last_scan_at = NOW(), last_status = 'ok', last_summary = ${JSON.stringify({ kind: result.kind, projects: result.discovery?.projects.length ?? null, scopes: result.usage ? result.usage.namespaces.length + result.usage.composeProjects.length : null, ...(result.unregistered ? { unregistered: result.unregistered.slice(0, 50) } : {}), ...(result.usageRecorded !== undefined ? { usageRecorded: result.usageRecorded } : {}) })} WHERE id = ${id}`;
    return result;
  } catch (error) {
    await queryClient`UPDATE connectors SET last_scan_at = NOW(), last_status = ${error instanceof ConnectorError ? error.code : "error"} WHERE id = ${id}`;
    throw error;
  }
}

async function refreshRegistered(discovery: Discovery, sourceRef: string): Promise<{ applied?: ApplySummary; unregistered: string[] }> {
  const slugs = discovery.projects.map(project => project.slug);
  const known = await queryClient`SELECT slug, archived_at IS NULL AS live FROM projects WHERE slug = ANY(${slugs})`;
  const live = new Set(known.filter(row => row.live).map(row => String(row.slug))), seen = new Set(known.map(row => String(row.slug)));
  const unregistered = slugs.filter(slug => !seen.has(slug)).sort();
  return live.size ? { applied: await applyProposal(discovery, [...live], sourceRef, undefined, { refreshOnly: true }), unregistered } : { unregistered };
}

/** Whole-machine readings from a successful scan replace that connector's previous ones; a machine the scan no longer returns is dropped rather than shown as current. */
export async function recordHostMeasurements(connectorId: string, hosts: HostCapacity[]): Promise<void> {
  await queryClient`DELETE FROM host_measurements WHERE connector_id = ${connectorId} AND NOT (instance = ANY(${hosts.map(host => host.instance)}))`;
  for (const host of hosts) {
    const key = hostKey(measuredHostName(host));
    await queryClient`
      INSERT INTO host_measurements (connector_id, instance, host_key, node_name, cpu_cores, cpu_busy_cores, mem_total_mi, mem_used_mi, measured_at)
      VALUES (${connectorId}, ${host.instance}, ${key}, ${host.nodeName}, ${host.cpuCores}, ${host.cpuBusyCores}, ${host.memTotalMi}, ${host.memUsedMi}, NOW())
      ON CONFLICT (connector_id, instance) DO UPDATE SET host_key = EXCLUDED.host_key, node_name = EXCLUDED.node_name, cpu_cores = EXCLUDED.cpu_cores, cpu_busy_cores = EXCLUDED.cpu_busy_cores, mem_total_mi = EXCLUDED.mem_total_mi, mem_used_mi = EXCLUDED.mem_used_mi, measured_at = NOW()`;
    const address = host.instance.replace(/:\d+$/, "");
    const kind = addressKind(address);
    if (kind) await queryClient`INSERT INTO host_addresses (host_key, address, kind, source) VALUES (${key}, ${address}, ${kind}, 'prometheus') ON CONFLICT (host_key, address) DO UPDATE SET last_seen = NOW()`;
  }
}

/** Measured usage becomes a project usage report on every placement whose scope (namespace or compose project) matches, and per project and machine for named containers. One row per quarter hour, idempotent. */
export async function recordMeasuredUsage(connectorId: string, usage: ScopeUsage[], containers: ContainerUsage[] = [], hosts: HostCapacity[] = []): Promise<number> {
  const bucket = Math.floor(Date.now() / 900_000);
  const end = new Date(bucket * 900_000 + 900_000 - 1), start = new Date(bucket * 900_000);
  let recorded = 0;
  const scopePlacements = usage.length ? await queryClient`
    SELECT pl.project_id, pl.host_name, pl.host_resource_id, pl.runtime, pl.scope
    FROM project_placements pl JOIN projects p ON p.id = pl.project_id
    WHERE pl.status = 'placed' AND p.archived_at IS NULL` : [];
  const scopeTotals = attributeScopes(usage, scopePlacements.map(p => ({ projectId: String(p.project_id), hostName: String(p.host_name), resourceId: p.host_resource_id as string | null, runtime: String(p.runtime), scope: String(p.scope ?? "") })), hosts);
  for (const entry of scopeTotals) {
    const key = `prom:v2:${connectorId}:${entry.kind}:${entry.projectId}:${hostKey(entry.hostName)}:${bucket}`;
    const metrics = { source: "prometheus", kind: entry.kind, scopes: entry.scopes, ...(entry.cpuCores !== null ? { cpuCores: entry.cpuCores } : {}), ...(entry.memMi !== null ? { memMi: entry.memMi } : {}) };
    const inserted = await queryClient`
      INSERT INTO project_usage_reports (id, project_id, idempotency_key, payload_hash, resource_id, resource_ref, amount, unit, period_start, period_end, metrics)
      VALUES (${`use-${randomUUID()}`}, ${entry.projectId}, ${key}, ${key}, ${entry.resourceId}, ${`host:${entry.hostName}`}, ${entry.cpuCores}, 'cores', ${start.toISOString()}, ${end.toISOString()}, ${JSON.stringify(metrics)})
      ON CONFLICT (project_id, idempotency_key) DO NOTHING RETURNING id`;
    recorded += inserted.length;
  }
  const placed = containers.length ? await queryClient`SELECT pl.project_id, pl.host_name, pl.host_resource_id, p.slug FROM project_placements pl JOIN projects p ON p.id = pl.project_id WHERE pl.status = 'placed' AND p.archived_at IS NULL AND pl.runtime IN ('docker', 'compose')` : [];
  const totals = attributeContainers(containers, placed.map(p => ({ projectId: String(p.project_id), hostName: String(p.host_name), resourceId: p.host_resource_id as string | null, slug: String(p.slug) })), hosts);
  for (const entry of totals) {
    const key = `prom:${connectorId}:containers:${entry.projectId}:${hostKey(entry.hostName)}:${bucket}`;
    const inserted = await queryClient`
      INSERT INTO project_usage_reports (id, project_id, idempotency_key, payload_hash, resource_id, resource_ref, amount, unit, period_start, period_end, metrics)
      VALUES (${`use-${randomUUID()}`}, ${entry.projectId}, ${key}, ${key}, ${entry.resourceId}, ${`host:${entry.hostName}`}, ${entry.cpuCores}, 'cores', ${start.toISOString()}, ${end.toISOString()}, ${JSON.stringify({ source: "prometheus", kind: "containers", ...(entry.cpuCores !== null ? { cpuCores: entry.cpuCores } : {}), ...(entry.memMi !== null ? { memMi: entry.memMi } : {}), containers: entry.containers })})
      ON CONFLICT (project_id, idempotency_key) DO NOTHING RETURNING id`;
    recorded += inserted.length;
  }
  return recorded;
}
