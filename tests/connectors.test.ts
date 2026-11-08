import { describe, expect, it } from "vitest";
import { normalizeCluster, parseFluxInventoryId, type ClusterSnapshot } from "../src/lib/connectors/kubernetes";
import { domainsFromLabels, normalizeDocker } from "../src/lib/connectors/docker";
import { attributeContainers, containerBelongs, joinContainers, joinHosts, joinUsage, measuredHostName, samplesFrom, usageQueries } from "../src/lib/connectors/prometheus";

const dep = (name: string, ns: string, over: any = {}) => ({ kind: "Deployment", metadata: { name, namespace: ns, ...(over.metadata ?? {}) }, spec: { replicas: over.replicas ?? 2, template: { spec: { containers: [{ name, image: `ghcr.io/acme/${name}:1`, resources: { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } } }] } } } });
const ing = (name: string, ns: string, host: string) => ({ kind: "Ingress", metadata: { name, namespace: ns }, spec: { rules: [{ host }] } });
const base: ClusterSnapshot = { deployments: [], statefulSets: [], ingresses: [], pvcs: [] };

describe("Flux inventory", () => {
  it("classifies shared agents and observability as platform even when they expose an ingress", () => {
    for (const namespace of ["monitoring-agent", "observability-agents", "observability", "arc-systems"]) {
      const result = normalizeCluster("host", { ...base, deployments: [dep("collector", namespace)], ingresses: [ing("collector", namespace, "metrics.example.com")] });
      expect(result.projects[0].kind).toBe("platform");
    }
  });

  it("parses inventory ids from the end", () => {
    expect(parseFluxInventoryId("default_podinfo_apps_Deployment")).toEqual({ namespace: "default", name: "podinfo", group: "apps", kind: "Deployment" });
    expect(parseFluxInventoryId("default_podinfo__Service")).toEqual({ namespace: "default", name: "podinfo", group: "", kind: "Service" });
    expect(parseFluxInventoryId("bad")).toBeNull();
  });
  it("groups workloads, ingress and PVCs by the Kustomization that applied them, whatever the repo layout", () => {
    const result = normalizeCluster("prod-1", {
      ...base,
      deployments: [dep("web", "shop"), dep("worker", "shop"), dep("cm", "cert-manager")],
      ingresses: [ing("web", "shop", "shop.example.com")],
      pvcs: [{ kind: "PersistentVolumeClaim", metadata: { name: "data", namespace: "shop" }, spec: { resources: { requests: { storage: "2Gi" } } } }],
      fluxKustomizations: [{ metadata: { name: "shopfront", namespace: "flux-system" }, status: { inventory: { entries: [{ id: "shop_web_apps_Deployment", v: "v1" }, { id: "shop_worker_apps_Deployment", v: "v1" }, { id: "shop_web_networking.k8s.io_Ingress", v: "v1" }] } } }],
    });
    const by = Object.fromEntries(result.projects.map(p => [p.slug, p]));
    expect(by.shopfront).toMatchObject({ kind: "app", domains: ["shop.example.com"], source: "k8s" });
    expect(by.shopfront.placements[0]).toMatchObject({ host: "prod-1", runtime: "k8s", scope: "shop" });
    expect(by.shopfront.placements[0].declared).toMatchObject({ replicas: 4, cpuRequestMilli: 400, memLimitMi: 1024, pvcGi: 2, containers: 4 });
    expect(by.shopfront.placements[0].evidence).toContain("Flux Kustomization flux-system/shopfront");
    expect(by["cert-manager"].kind).toBe("platform");
  });
});

describe("root and app-of-apps objects", () => {
  it("does not let a root Kustomization or Argo app-of-apps swallow every project", () => {
    const labelled = (name: string, ns: string) => dep(name, ns, { metadata: { labels: { "kustomize.toolkit.fluxcd.io/name": "flux-system" } } });
    const result = normalizeCluster("c", { ...base, deployments: [labelled("a", "alpha"), labelled("b", "beta"), dep("c", "gamma", { metadata: { labels: { "argocd.argoproj.io/instance": "root" } } })],
      fluxKustomizations: [{ metadata: { name: "flux-system" }, status: { inventory: { entries: [{ id: "flux-system_child_kustomize.toolkit.fluxcd.io_Kustomization" }, { id: "alpha_a_apps_Deployment" }, { id: "beta_b_apps_Deployment" }] } } }],
      argoApplications: [{ metadata: { name: "root" }, status: { resources: [{ kind: "Application", namespace: "argocd", name: "child" }, { kind: "Deployment", namespace: "gamma", name: "c" }] } }] });
    expect(result.projects.map(p => p.slug)).toEqual(["alpha", "beta", "gamma"]);
    expect(result.projects.every(p => p.placements[0].evidence.includes("namespace"))).toBe(true);
  });
  it("treats an object spanning more than four namespaces as an aggregate too", () => {
    const entries = ["n1", "n2", "n3", "n4", "n5"].map(ns => ({ id: `${ns}_w_apps_Deployment` }));
    const result = normalizeCluster("c", { ...base, deployments: ["n1", "n2", "n3", "n4", "n5"].map(ns => dep("w", ns)), fluxKustomizations: [{ metadata: { name: "everything" }, status: { inventory: { entries } } }] });
    expect(result.projects).toHaveLength(5);
  });
});

describe("Argo CD and Helm", () => {
  it("uses Application status.resources as the project", () => {
    const result = normalizeCluster("c", { ...base, deployments: [dep("api", "team-a"), dep("db", "team-a")], ingresses: [ing("api", "team-a", "api.example.org")],
      argoApplications: [{ metadata: { name: "billing" }, status: { resources: [{ kind: "Deployment", namespace: "team-a", name: "api" }, { kind: "Deployment", namespace: "team-a", name: "db" }, { kind: "Ingress", namespace: "team-a", name: "api" }] } }] });
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({ slug: "billing", kind: "app", domains: ["api.example.org"] });
    expect(result.projects[0].placements[0].evidence).toContain("Argo CD Application billing");
  });
  it("falls back to Helm release annotation, recommended labels, then the namespace", () => {
    const result = normalizeCluster("c", { ...base, deployments: [
      dep("a-web", "n1", { metadata: { annotations: { "meta.helm.sh/release-name": "myrelease" } } }),
      dep("b-web", "n2", { metadata: { labels: { "app.kubernetes.io/instance": "labelled" } } }),
      dep("c-web", "plain-ns"),
    ] });
    expect(result.projects.map(p => [p.slug, p.placements[0].evidence.split(";")[0]])).toEqual([
      ["labelled", "grouped by label app.kubernetes.io/instance=labelled"], ["myrelease", "grouped by Helm release myrelease"], ["plain-ns", "grouped by namespace plain-ns"],
    ]);
  });
  it("handles missing CRD lists and malformed objects without throwing", () => {
    expect(normalizeCluster("c", { deployments: [{}, null as any, { metadata: {} }], statefulSets: [], ingresses: [], pvcs: [] }).projects).toEqual([]);
  });
});

describe("Docker", () => {
  it("groups by Compose project and reads proxy labels and limits", () => {
    const result = normalizeDocker("atlas", {
      containers: [
        { Id: "1", Names: ["/shop-web-1"], Image: "ghcr.io/a/web:2", State: "running", Labels: { "com.docker.compose.project": "shop", "traefik.http.routers.web.rule": "Host(`shop.example.com`) && PathPrefix(`/`)" } },
        { Id: "2", Names: ["/shop-db-1"], Image: "postgres:17", State: "running", Labels: { "com.docker.compose.project": "shop" } },
        { Id: "3", Names: ["/old-1"], Image: "x", State: "exited", Labels: { "com.docker.compose.project": "old" } },
        { Id: "4", Names: ["/loner"], Image: "redis:7", State: "running", Labels: {} },
      ],
      inspect: { "1": { HostConfig: { NanoCpus: 500_000_000, Memory: 268435456 } }, "2": { HostConfig: { Memory: 536870912, MemoryReservation: 134217728 } } },
    });
    const by = Object.fromEntries(result.projects.map(p => [p.slug, p]));
    expect(by.shop).toMatchObject({ kind: "app", domains: ["shop.example.com"], source: "docker" });
    expect(by.shop.placements[0].declared).toMatchObject({ containers: 2, cpuLimitMilli: 500, memLimitMi: 768, memRequestMi: 128 });
    expect(by.old.placements[0].declared.containers).toBe(0);
    expect(by.loner.kind).toBe("service");
  });
  it("reads Traefik and Caddy host labels only", () => {
    expect(domainsFromLabels({ "traefik.http.routers.x.rule": "Host(`A.com`,`b.com`)", caddy: "c.example.org", other: "Host(`no.com`)" }).sort()).toEqual(["a.com", "b.com", "c.example.org"]);
  });
});

describe("Prometheus", () => {
  it("drops malformed samples and joins CPU with memory by scope", () => {
    const cpu = samplesFrom({ data: { result: [{ metric: { namespace: "shop" }, value: [1, "0.25"] }, { metric: { namespace: "bad" }, value: [1, "NaN"] }, { nope: 1 }] } });
    const mem = samplesFrom({ data: { result: [{ metric: { namespace: "shop" }, value: [1, "268435456"] }, { metric: { namespace: "other" }, value: [1, "1048576"] }] } });
    expect(cpu).toHaveLength(1);
    expect(joinUsage(cpu, mem, "namespace")).toEqual([{ scope: "other", instance: "", kind: "namespace", cpuCores: null, memMi: 1 }, { scope: "shop", instance: "", kind: "namespace", cpuCores: 0.25, memMi: 256 }]);
    expect(samplesFrom("nonsense")).toEqual([]);
  });
  it("reports whole-machine capacity from node_exporter", () => {
    const s = (instance: string, value: number) => ({ labels: { instance }, value });
    expect(joinHosts({ cores: [s("a:9100", 2)], busy: [s("a:9100", 0.84)], total: [s("a:9100", 12 * 1073741824)], used: [s("a:9100", 4 * 1073741824)] }))
      .toEqual([{ instance: "a:9100", nodeName: null, cpuCores: 2, cpuBusyCores: 0.84, memTotalMi: 12288, memUsedMi: 4096 }]);
  });
  it("names a machine from node_uname_info and ignores names for unknown instances", () => {
    const sample = (labels: Record<string, string>, value: number) => ({ labels, value });
    const hosts = joinHosts({ cores: [sample({ instance: "10.0.0.190:9100" }, 4)], busy: [], total: [], used: [], names: [sample({ instance: "10.0.0.190:9100", nodename: "borealis" }, 1), sample({ instance: "10.9.9.9:9100", nodename: "ghost" }, 1), sample({ instance: "10.0.0.190:9100" }, 1)] });
    expect(hosts).toEqual([expect.objectContaining({ instance: "10.0.0.190:9100", nodeName: "borealis", cpuCores: 4 })]);
  });
  it("joins plain Docker containers by machine and name, and matches them to project slugs by an exact rule", () => {
    const sample = (name: string, value: number, instance = "atlas") => ({ labels: { instance, name }, value });
    expect(joinContainers([sample("kanban-oauth2", 0.0123456), sample("", 1)], [sample("kanban-oauth2", 5 * 1048576), sample("alloy", 1048576)])).toEqual([
      { instance: "atlas", name: "alloy", cpuCores: null, memMi: 1 }, { instance: "atlas", name: "kanban-oauth2", cpuCores: 0.012, memMi: 5 }]);
    expect(containerBelongs("kanban-oauth2", "kanban")).toBe(true);
    expect(containerBelongs("/Kanban", "kanban")).toBe(true);
    expect(containerBelongs("kanbanboard", "kanban")).toBe(false);
    expect(containerBelongs("my-kanban", "kanban")).toBe(false);
  });
  it("names a measured machine by its node name only when the instance is an address", () => {
    expect(measuredHostName({ instance: "10.0.0.190:9100", nodeName: "borealis" })).toBe("borealis");
    expect(measuredHostName({ instance: "10.0.0.190:9100", nodeName: null })).toBe("10.0.0.190");
    expect(measuredHostName({ instance: "atlas", nodeName: "3f2a9c1d0b7e" })).toBe("atlas");
    expect(measuredHostName({ instance: "atlas:9100", nodeName: null })).toBe("atlas");
  });
  it("attributes containers per project and machine, resolving ports and IP instances first", () => {
    const placements = [
      { projectId: "p1", hostName: "atlas", resourceId: "r-atlas", slug: "kanban" },
      { projectId: "p1", hostName: "borealis", resourceId: "r-bore", slug: "kanban" },
      { projectId: "p2", hostName: "atlas", resourceId: "r-atlas", slug: "alloy" },
    ];
    const hosts = [{ instance: "10.0.0.190:9100", nodeName: "borealis", cpuCores: 2, cpuBusyCores: 1, memTotalMi: 1, memUsedMi: 1 }];
    const totals = attributeContainers([
      { instance: "atlas:9100", name: "kanban", cpuCores: 0.1, memMi: 10 },
      { instance: "atlas", name: "kanban-oauth2", cpuCores: 0.2, memMi: null },
      { instance: "10.0.0.190:8080", name: "kanban", cpuCores: 0.5, memMi: 50 },
      { instance: "elsewhere", name: "kanban", cpuCores: 9, memMi: 9 },
    ], placements, hosts);
    expect(totals).toEqual([
      { projectId: "p1", hostName: "atlas", resourceId: "r-atlas", cpuCores: 0.3, memMi: null, containers: ["kanban", "kanban-oauth2"] },
      { projectId: "p1", hostName: "borealis", resourceId: "r-bore", cpuCores: 0.5, memMi: 50, containers: ["kanban"] },
    ]);
    expect(attributeContainers([{ instance: "atlas", name: "alloy", cpuCores: null, memMi: 3 }], placements)).toEqual([{ projectId: "p2", hostName: "atlas", resourceId: "r-atlas", cpuCores: null, memMi: 3, containers: ["alloy"] }]);
  });
  it("gives both sides of the container fallback the same labels so a textfile reading wins", () => {
    for (const query of [usageQueries.cpuCoresByContainer, usageQueries.memBytesByContainer]) {
      const [textfile, cadvisor] = query.split(" or ");
      expect(textfile).toMatch(/^max by \(instance, name\) \(label_replace\(/);
      expect(cadvisor).toMatch(/^sum by \(instance, name\) /);
      expect(cadvisor).toContain('container_label_com_docker_compose_project=""');
    }
  });
});
