import { parseAllDocuments } from "yaml";
import { isSecretLikePath, parseRepo, type GitopsFile, type ParsedRepo } from "./parse";

export type ProjectKind = "app" | "service" | "platform";
export interface Declared { replicas: number | null; cpuRequestMilli: number; cpuLimitMilli: number; memRequestMi: number; memLimitMi: number; pvcGi: number; containers: number }
export type Runtime = "flux" | "compose" | "k8s" | "docker";
export interface Placement { host: string; runtime: Runtime; evidence: string; declared: Declared; scope?: string }
export interface ProposedProject {
  slug: string; name: string; kind: ProjectKind; dir: string; domains: string[]; images: string[];
  placements: Placement[]; source: "flux" | "compose" | "k8s" | "docker"; reason: string; fileCount: number;
}
export interface Discovery {
  hosts: Array<{ name: string; runtime: Runtime }>;
  projects: ProposedProject[];
  findings: Array<{ type: "defined_but_unplaced" | "placed_on_multiple_hosts"; project: string; detail: string }>;
  skipped: Array<{ path: string; reason: string }>;
}

const platformDir = /^(kube-system|monitoring-agent|observability-agents|cert-manager|external-dns|external-secrets|flux-system|reloader|cleanup|observability.*|.*-eso(-.*)?|arc-(controller|runners.*)|backups.*|storageclasses|pvs|base|alloy|nginx)$/;
const slugOf = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 39).replace(/-+$/g, "");
const emptyDeclared = (): Declared => ({ replicas: null, cpuRequestMilli: 0, cpuLimitMilli: 0, memRequestMi: 0, memLimitMi: 0, pvcGi: 0, containers: 0 });

export function cpuMilli(value: unknown): number {
  if (typeof value === "number") return Math.round(value * 1000);
  if (typeof value !== "string") return 0;
  const m = /^(\d+(?:\.\d+)?)(m?)$/.exec(value.trim());
  return m ? Math.round(Number(m[1]) * (m[2] === "m" ? 1 : 1000)) : 0;
}
export function memMi(value: unknown): number {
  if (typeof value === "number") return Math.round(value / 1048576);
  if (typeof value !== "string") return 0;
  const m = /^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|k|K|M|G|T)?$/.exec(value.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  const factor: Record<string, number> = { Ki: 1 / 1024, Mi: 1, Gi: 1024, Ti: 1048576, k: 1000 / 1048576, K: 1000 / 1048576, M: 1e6 / 1048576, G: 1e9 / 1048576, T: 1e12 / 1048576 };
  return Math.round(n * (m[2] ? factor[m[2]] : 1 / 1048576));
}
/** Docker Compose sizes use binary units (512m, 1g, 2gb). */
export function composeMemMi(value: unknown): number {
  if (typeof value === "number") return Math.round(value / 1048576);
  if (typeof value !== "string") return 0;
  const m = /^(\d+(?:\.\d+)?)\s*([kmg]?)b?$/i.exec(value.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  return Math.round(m[2].toLowerCase() === "g" ? n * 1024 : m[2].toLowerCase() === "m" ? n : m[2].toLowerCase() === "k" ? n / 1024 : n / 1048576);
}
const gi = (value: unknown) => memMi(value) / 1024;

function docsOf(file: GitopsFile): any[] {
  try { return parseAllDocuments(file.content, { strict: true, uniqueKeys: true }).filter(doc => !doc.errors.length).map(doc => { try { return doc.toJS({ maxAliasCount: 20 }); } catch { return null; } }).filter(Boolean); } catch { return []; }
}

/** Declared requests and limits from Deployments, StatefulSets, DaemonSets and PVCs: replicas multiply container sizes. */
function declaredFrom(files: GitopsFile[]): Declared {
  const out = emptyDeclared();
  for (const file of files) for (const doc of docsOf(file)) {
    if (typeof doc?.kind !== "string") continue;
    if (doc.kind === "PersistentVolumeClaim") { out.pvcGi += gi(doc.spec?.resources?.requests?.storage); continue; }
    if (!["Deployment", "StatefulSet"].includes(doc.kind)) continue;
    const replicas = Number.isInteger(doc.spec?.replicas) ? doc.spec.replicas : 1;
    out.replicas = (out.replicas ?? 0) + replicas;
    for (const container of Array.isArray(doc.spec?.template?.spec?.containers) ? doc.spec.template.spec.containers : []) {
      out.containers += replicas;
      out.cpuRequestMilli += replicas * cpuMilli(container?.resources?.requests?.cpu); out.cpuLimitMilli += replicas * cpuMilli(container?.resources?.limits?.cpu);
      out.memRequestMi += replicas * memMi(container?.resources?.requests?.memory); out.memLimitMi += replicas * memMi(container?.resources?.limits?.memory);
    }
    for (const claim of Array.isArray(doc.spec?.volumeClaimTemplates) ? doc.spec.volumeClaimTemplates : []) out.pvcGi += replicas * gi(claim?.spec?.resources?.requests?.storage);
  }
  return out;
}

function composeDeclared(file: GitopsFile): { declared: Declared; images: string[] } {
  const declared = emptyDeclared(); const images: string[] = [];
  for (const doc of docsOf(file)) for (const service of Object.values<any>(doc?.services ?? {})) {
    declared.containers += 1;
    if (typeof service?.image === "string") images.push(service.image.split(":")[0]);
    const limits = service?.deploy?.resources?.limits ?? {};
    declared.cpuLimitMilli += cpuMilli(limits.cpus ?? service?.cpus); declared.memLimitMi += composeMemMi(limits.memory ?? service?.mem_limit);
    const reservations = service?.deploy?.resources?.reservations ?? {};
    declared.cpuRequestMilli += cpuMilli(reservations.cpus); declared.memRequestMi += composeMemMi(reservations.memory);
  }
  return { declared, images: [...new Set(images)].slice(0, 20) };
}

/** Which app directories each cluster deploys: its kustomization `resources`, plus Flux Kustomization objects whose `spec.path` points into apps/. */
function clusterApps(files: GitopsFile[]): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  for (const file of files) {
    const m = /^clusters\/([^/]+)\/(.+\.ya?ml)$/.exec(file.path);
    if (!m || isSecretLikePath(file.path) || m[2].startsWith("flux-system/")) continue;
    const apps = out.get(m[1]) ?? new Map<string, string>();
    for (const doc of docsOf(file)) {
      for (const resource of Array.isArray(doc?.resources) ? doc.resources : []) {
        const dir = typeof resource === "string" ? /(?:^|\/)apps\/([^/]+)\/?$/.exec(resource)?.[1] : undefined;
        if (dir) apps.set(dir, `listed in ${file.path}`);
      }
      if (doc?.kind === "Kustomization" && typeof doc.spec?.path === "string") {
        const dir = /(?:^|\/)apps\/([^/]+)\/?$/.exec(doc.spec.path)?.[1];
        if (dir) apps.set(dir, `Flux Kustomization ${doc.metadata?.name ?? ""} in ${file.path}`.trim());
      }
    }
    out.set(m[1], apps);
  }
  return out;
}

/**
 * Pure read of a GitOps checkout. Flux layout: clusters/<host>/kustomization.yaml and Flux objects say what each cluster deploys, apps/<dir> holds the manifests.
 * Compose layout: servers/<host>/<stack>/docker-compose.y(a)ml, one project per stack. Secret-like files are never opened. Nothing is written or run.
 */
export function discover(files: GitopsFile[]): Discovery {
  const safe = files.filter(file => !isSecretLikePath(file.path));
  const skipped = files.filter(file => isSecretLikePath(file.path)).map(file => ({ path: file.path.slice(0, 120), reason: "secret-like name, not read" }));
  const hosts = new Map<string, "flux" | "compose">();
  const projects = new Map<string, ProposedProject>();

  const byCluster = clusterApps(safe);
  for (const name of byCluster.keys()) hosts.set(name, "flux");
  const appFiles = new Map<string, GitopsFile[]>();
  for (const file of safe) { const m = /^apps\/([^/]+)\/.+\.ya?ml$/.exec(file.path); if (m) appFiles.set(m[1], [...(appFiles.get(m[1]) ?? []), file]); }
  const findings: Discovery["findings"] = [];
  for (const [dir, group] of [...appFiles.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const parsed: ParsedRepo = parseRepo(group);
    const domains = [...new Set(parsed.workloads.flatMap(workload => workload.hosts))].filter(host => !host.startsWith("*")).slice(0, 10);
    const images = [...new Set(parsed.workloads.flatMap(workload => workload.images.map(image => image.split(":")[0].split("@")[0])))].slice(0, 20);
    const placed = [...byCluster.entries()].filter(([, apps]) => apps.has(dir));
    const platform = platformDir.test(dir);
    const kind: ProjectKind = platform ? "platform" : domains.length ? "app" : "service";
    const slug = slugOf(dir);
    if (slug.length < 2) continue;
    const declared = declaredFrom(group);
    projects.set(slug, {
      slug, name: dir, kind, dir: `apps/${dir}`, domains, images, source: "flux", fileCount: group.length,
      reason: platform ? "platform directory name (shared cluster plumbing)" : domains.length ? `serves ${domains[0]}${domains.length > 1 ? ` and ${domains.length - 1} more` : ""}` : "no public hostname: supporting service",
      placements: placed.map(([host, apps]) => ({ host, runtime: "flux" as const, evidence: `${dir} ${apps.get(dir)}`, declared })),
    });
    if (!placed.length) findings.push({ type: "defined_but_unplaced", project: slug, detail: `apps/${dir} exists but no cluster deploys it` });
    if (placed.length > 1 && !platform) findings.push({ type: "placed_on_multiple_hosts", project: slug, detail: `deployed on ${placed.map(([host]) => host).join(" and ")}` });
  }

  for (const file of safe) {
    const m = /^servers\/([^/]+)\/([^/]+)\/(docker-compose|compose)\.ya?ml$/.exec(file.path);
    if (!m) continue;
    const [, host, stack] = m;
    hosts.set(host, hosts.get(host) ?? "compose");
    const { declared, images } = composeDeclared(file);
    const slug = slugOf(stack);
    if (slug.length < 2) continue;
    const existing = projects.get(slug);
    const placement: Placement = { host, runtime: "compose", evidence: `compose stack ${stack} in ${file.path}`, declared };
    if (existing) { existing.placements.push(placement); continue; }
    projects.set(slug, { slug, name: stack, kind: platformDir.test(stack) ? "platform" : "service", dir: `servers/${host}/${stack}`, domains: [], images, source: "compose", fileCount: 1, reason: `Docker Compose stack on ${host} (${declared.containers} container${declared.containers === 1 ? "" : "s"})`, placements: [placement] });
  }
  return { hosts: [...hosts].map(([name, runtime]) => ({ name, runtime })).sort((a, b) => a.name.localeCompare(b.name)), projects: [...projects.values()], findings, skipped: [...skipped, ...[]].slice(0, 100) };
}

/** Manifest files belonging to one proposed project, for link inference on apply. */
export function filesForProject(files: GitopsFile[], project: Pick<ProposedProject, "dir">): GitopsFile[] {
  return files.filter(file => !isSecretLikePath(file.path) && file.path.startsWith(`${project.dir}/`));
}
