import type { Declared, Discovery, ProjectKind, ProposedProject } from "@/lib/gitops/discover";
import { cpuMilli, memMi } from "@/lib/gitops/discover";

/** What a live scan of one cluster returns. Every list is the raw Kubernetes API `items` array; missing CRD lists are simply absent. */
export interface ClusterSnapshot {
  deployments: any[]; statefulSets: any[]; daemonSets?: any[]; ingresses: any[]; pvcs: any[];
  fluxKustomizations?: any[]; fluxHelmReleases?: any[]; argoApplications?: any[];
}

type Group = { key: string; name: string; via: string; namespaces: Set<string>; workloads: any[]; ingresses: any[]; pvcs: any[] };

const idOf = (kind: string, namespace: string | undefined, name: string) => `${namespace ?? ""}/${kind}/${name}`;
const slugOf = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 39).replace(/-+$/g, "");

/** Namespaces that exist in every Kubernetes distribution or CD tool. Anything else is judged by what it serves, not by name. */
const platformNamespaces = /^(kube-system|kube-public|kube-node-lease|flux-system|argocd|argo-.*|cert-manager|ingress-nginx|traefik|metallb-system|cilium|calico-system|tigera-operator|longhorn-system|local-path-storage|arc-systems|backups|reloader|observability|monitoring|monitoring-agent|observability-agents|prometheus|linkerd|istio-system|external-secrets|external-dns|gatekeeper-system|kyverno|cattle-.*|fleet-.*)$/;

/** Flux inventory ids look like `ns_name_group_Kind`; names may contain underscores only for cluster-scoped legacy cases, so split from the end. */
export function parseFluxInventoryId(id: string): { namespace: string; name: string; group: string; kind: string } | null {
  const parts = id.split("_");
  if (parts.length < 4) return null;
  const kind = parts[parts.length - 1], group = parts[parts.length - 2], namespace = parts[0], name = parts.slice(1, -2).join("_");
  return name && kind ? { namespace, name, group, kind } : null;
}

function declaredOf(workloads: any[], pvcs: any[]): Declared {
  const out: Declared = { replicas: null, cpuRequestMilli: 0, cpuLimitMilli: 0, memRequestMi: 0, memLimitMi: 0, pvcGi: 0, containers: 0 };
  for (const item of workloads) {
    const kind = item.kind as string;
    const replicas = kind === "DaemonSet" ? Number(item.status?.desiredNumberScheduled ?? 1) : Number.isInteger(item.spec?.replicas) ? item.spec.replicas : 1;
    out.replicas = (out.replicas ?? 0) + replicas;
    for (const c of item.spec?.template?.spec?.containers ?? []) {
      out.containers += replicas;
      out.cpuRequestMilli += replicas * cpuMilli(c?.resources?.requests?.cpu); out.cpuLimitMilli += replicas * cpuMilli(c?.resources?.limits?.cpu);
      out.memRequestMi += replicas * memMi(c?.resources?.requests?.memory); out.memLimitMi += replicas * memMi(c?.resources?.limits?.memory);
    }
  }
  for (const claim of pvcs) out.pvcGi += memMi(claim?.spec?.resources?.requests?.storage) / 1024;
  return out;
}

/**
 * Groups live objects into projects deterministically, strongest evidence first:
 * 1. Argo CD Application `status.resources` (project = Application);
 * 2. Flux Kustomization `status.inventory` (project = Kustomization), HelmRelease by its release name label;
 * 3. Helm or recommended labels: `app.kubernetes.io/instance`, then `app.kubernetes.io/part-of`, `meta.helm.sh/release-name`;
 * 4. the namespace, as the last resort.
 * No names are special-cased. Host = the cluster the caller names.
 */
export function normalizeCluster(cluster: string, snapshot: ClusterSnapshot): Discovery {
  const workloads = [...snapshot.deployments, ...snapshot.statefulSets, ...(snapshot.daemonSets ?? [])].filter(item => item?.metadata?.name);
  const claim = new Map<string, { name: string; via: string }>();
  const aggregators = new Set<string>();
  const cdKinds = new Set(["Kustomization", "HelmRelease", "Application", "ApplicationSet", "GitRepository", "HelmRepository"]);
  /** A root or app-of-apps object that deploys other CD objects, or spreads over many namespaces, says "everything" and not "this project", so it never names a project. */
  const isAggregate = (refs: Array<{ kind: string; namespace: string }>) => refs.some(r => cdKinds.has(r.kind)) || new Set(refs.map(r => r.namespace).filter(Boolean)).size > 4;
  for (const app of snapshot.argoApplications ?? []) {
    const name = app?.metadata?.name as string | undefined;
    if (!name) continue;
    const refs = (app?.status?.resources ?? []).filter((r: any) => r?.kind && r?.name).map((r: any) => ({ kind: String(r.kind), namespace: String(r.namespace ?? ""), name: String(r.name) }));
    if (isAggregate(refs)) { aggregators.add(name); continue; }
    for (const r of refs) claim.set(idOf(r.kind, r.namespace, r.name), { name, via: `Argo CD Application ${name}` });
  }
  for (const k of snapshot.fluxKustomizations ?? []) {
    const name = k?.metadata?.name as string | undefined;
    if (!name) continue;
    const refs = (k?.status?.inventory?.entries ?? []).flatMap((entry: any) => { const parsed = typeof entry?.id === "string" ? parseFluxInventoryId(entry.id) : null; return parsed ? [parsed] : []; });
    if (isAggregate(refs)) { aggregators.add(name); continue; }
    for (const parsed of refs) if (!claim.has(idOf(parsed.kind, parsed.namespace, parsed.name))) claim.set(idOf(parsed.kind, parsed.namespace, parsed.name), { name, via: `Flux Kustomization ${k.metadata.namespace ?? "flux-system"}/${name}` });
  }
  const groups = new Map<string, Group>();
  const groupFor = (obj: any): Group => {
    const meta = obj.metadata ?? {}; const labels = meta.labels ?? {}; const annotations = meta.annotations ?? {};
    const hit = claim.get(idOf(obj.kind ?? "", meta.namespace, meta.name));
    const labelled = (labels["helm.toolkit.fluxcd.io/name"] && { name: labels["helm.toolkit.fluxcd.io/name"], via: `Flux HelmRelease ${labels["helm.toolkit.fluxcd.io/name"]}` })
      || (labels["kustomize.toolkit.fluxcd.io/name"] && !aggregators.has(labels["kustomize.toolkit.fluxcd.io/name"]) && { name: labels["kustomize.toolkit.fluxcd.io/name"], via: `Flux Kustomization ${labels["kustomize.toolkit.fluxcd.io/name"]}` })
      || (labels["argocd.argoproj.io/instance"] && !aggregators.has(labels["argocd.argoproj.io/instance"]) && { name: labels["argocd.argoproj.io/instance"], via: `Argo CD Application ${labels["argocd.argoproj.io/instance"]}` })
      || (annotations["meta.helm.sh/release-name"] && { name: annotations["meta.helm.sh/release-name"], via: `Helm release ${annotations["meta.helm.sh/release-name"]}` })
      || (labels["app.kubernetes.io/instance"] && { name: labels["app.kubernetes.io/instance"], via: `label app.kubernetes.io/instance=${labels["app.kubernetes.io/instance"]}` })
      || (labels["app.kubernetes.io/part-of"] && { name: labels["app.kubernetes.io/part-of"], via: `label app.kubernetes.io/part-of=${labels["app.kubernetes.io/part-of"]}` });
    const chosen = hit ?? labelled ?? { name: meta.namespace ?? "default", via: `namespace ${meta.namespace ?? "default"}` };
    const key = slugOf(String(chosen.name));
    const group = groups.get(key) ?? { key, name: String(chosen.name), via: chosen.via, namespaces: new Set<string>(), workloads: [], ingresses: [], pvcs: [] };
    if (meta.namespace) group.namespaces.add(meta.namespace);
    groups.set(key, group);
    return group;
  };
  for (const w of workloads) groupFor(w).workloads.push(w);
  const nsToGroups = new Map<string, Group[]>();
  for (const g of groups.values()) for (const ns of g.namespaces) nsToGroups.set(ns, [...(nsToGroups.get(ns) ?? []), g]);
  for (const ing of snapshot.ingresses ?? []) {
    const hit = claim.get(idOf("Ingress", ing?.metadata?.namespace, ing?.metadata?.name));
    const target = (hit && groups.get(slugOf(hit.name))) || (ing?.metadata?.labels?.["app.kubernetes.io/instance"] && groups.get(slugOf(ing.metadata.labels["app.kubernetes.io/instance"]))) || (nsToGroups.get(ing?.metadata?.namespace ?? "") ?? [])[0];
    if (target) target.ingresses.push(ing);
  }
  for (const pvc of snapshot.pvcs ?? []) {
    const hit = claim.get(idOf("PersistentVolumeClaim", pvc?.metadata?.namespace, pvc?.metadata?.name));
    const target = (hit && groups.get(slugOf(hit.name))) || (nsToGroups.get(pvc?.metadata?.namespace ?? "") ?? [])[0];
    if (target) target.pvcs.push(pvc);
  }
  const projects: ProposedProject[] = [];
  for (const g of [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    if (g.key.length < 2) continue;
    const domains = [...new Set(g.ingresses.flatMap(ing => (ing?.spec?.rules ?? []).map((r: any) => r?.host).filter((h: unknown): h is string => typeof h === "string" && !h.startsWith("*"))))].slice(0, 10);
    const images = [...new Set(g.workloads.flatMap(w => (w.spec?.template?.spec?.containers ?? []).map((c: any) => String(c?.image ?? "").split(":")[0].split("@")[0]).filter(Boolean)))].slice(0, 20);
    const namespaces = [...g.namespaces];
    const platform = namespaces.length > 0 && namespaces.every(ns => platformNamespaces.test(ns));
    const kind: ProjectKind = platform ? "platform" : domains.length ? "app" : "service";
    projects.push({
      slug: g.key, name: g.name, kind, dir: namespaces.join(","), domains, images, source: "k8s", fileCount: g.workloads.length,
      reason: platform ? `runs only in platform namespace${namespaces.length > 1 ? "s" : ""} ${namespaces.join(", ")}` : domains.length ? `serves ${domains[0]}${domains.length > 1 ? ` and ${domains.length - 1} more` : ""}` : "no public hostname: supporting service",
      placements: [{ host: cluster, runtime: "k8s", evidence: `grouped by ${g.via}; namespaces ${namespaces.join(", ") || "none"}`, declared: declaredOf(g.workloads, g.pvcs), scope: namespaces.join(",") }],
    });
  }
  return { hosts: [{ name: cluster, runtime: "k8s" }], projects, findings: [], skipped: [] };
}
