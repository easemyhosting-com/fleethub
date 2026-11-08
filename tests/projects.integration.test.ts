import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
import { authenticateProjectKey, createProjectKey, revokeProjectKey } from "../src/lib/projects/keys";
import { readHostCapacities } from "../src/lib/capacity/read";
import { readFootprints, readOrphans, readUsedBy } from "../src/lib/projects/footprint";
import { decideLink, syncProjectFromFiles } from "../src/lib/gitops/sync";
import { applyProposal } from "../src/lib/gitops/register";
import { normalizeCluster } from "../src/lib/connectors/kubernetes";
import { recordMeasuredUsage } from "../src/lib/connectors/service";
import { applyDiscovery } from "../src/lib/gitops/register";
import { updateProject } from "../src/lib/projects/store";
import { createProject, recordNeed, recordUsage, ReportConflict, SlugTaken } from "../src/lib/projects/store";

describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("projects PostgreSQL storage", () => {
  let projectId = "";
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires disposable local database");
    expect((await bootstrapDatabase()).success).toBe(true);
    await queryClient`INSERT INTO resources (id,name,category,provider,account_email,state) VALUES ('proj-free-db','Free DB','database','neon','a@x.test','online'), ('proj-paid-db','Paid DB','database','neon','a@x.test','online') ON CONFLICT DO NOTHING`;
    await queryClient`UPDATE resources SET attributes = ${JSON.stringify({ billing: "billable" })} WHERE id = 'proj-paid-db'`;
    await queryClient`UPDATE resources SET attributes = ${JSON.stringify({ billing: "free_tier" })} WHERE id = 'proj-free-db'`;
    projectId = (await createProject({ slug: "integration-app", name: "Integration app", environment: "prod", criticality: "normal" }, null)).id;
  });
  afterAll(async () => {
    await queryClient`DELETE FROM projects WHERE slug = 'integration-app'`;
    await queryClient`DELETE FROM resources WHERE id IN ('proj-free-db','proj-paid-db')`;
    await queryClient.end();
  });

  it("rejects a duplicate slug", async () => {
    await expect(createProject({ slug: "integration-app", name: "Again", environment: "prod", criticality: "normal" }, null)).rejects.toBeInstanceOf(SlugTaken);
  });
  it("authenticates a project key, scoped to its project, until revoked", async () => {
    const created = await createProjectKey(projectId, 30, "test");
    expect(await authenticateProjectKey(created.key)).toMatchObject({ status: "valid", projectId });
    expect(await revokeProjectKey(created.id)).toBe(true);
    expect(await authenticateProjectKey(created.key)).toEqual({ status: "invalid" });
  });
  it("answers a need with free-tier candidates only and deduplicates concurrent retries", async () => {
    const need = { kind: "database" as const, purpose: "primary database", spec: {} };
    const results = await Promise.all(Array.from({ length: 6 }, () => recordNeed(projectId, "need-key", need)));
    expect(new Set(results.map(result => result.id)).size).toBe(1);
    expect(results.filter(result => !result.duplicate)).toHaveLength(1);
    const ids = (results[0].recommendation as { candidates: Array<{ resourceId: string }> }).candidates.map(item => item.resourceId);
    expect(ids).toContain("proj-free-db"); expect(ids).not.toContain("proj-paid-db");
    await expect(recordNeed(projectId, "need-key", { ...need, purpose: "something else" })).rejects.toBeInstanceOf(ReportConflict);
  });
  it("accepts usage with no need, links a registered resource, and keeps unknown references", async () => {
    const period = { periodStart: new Date(Date.now() - 3600_000).toISOString(), periodEnd: new Date().toISOString(), metrics: {} };
    expect(await recordUsage(projectId, "use-1", { resource: "proj-free-db", amount: 1, unit: "GB", ...period })).toMatchObject({ matched: true, duplicate: false });
    expect(await recordUsage(projectId, "use-1", { resource: "proj-free-db", amount: 1, unit: "GB", ...period })).toMatchObject({ duplicate: true });
    expect(await recordUsage(projectId, "use-2", { resource: "not-registered", ...period })).toMatchObject({ matched: false });
    const links = await queryClient`SELECT source, status FROM project_resource_links WHERE project_id = ${projectId}`;
    expect(links).toEqual([{ source: "declared", status: "in_use" }]);
    const [{ count }] = await queryClient`SELECT COUNT(*)::int AS count FROM project_usage_reports WHERE project_id = ${projectId}`;
    expect(count).toBe(2);
  });

  it("reports the footprint, orphans and used-by from stored links", async () => {
    const [footprint] = await readFootprints("integration-app");
    expect(footprint).toMatchObject({ slug: "integration-app", usageState: "reporting", unallocatedUsage: 1, billableLinks: 0 });
    expect(footprint.links).toHaveLength(1); expect(footprint.links[0]).toMatchObject({ resourceId: "proj-free-db", source: "declared" });
    expect(footprint.needs[0]).toMatchObject({ kind: "database", topCandidate: "Free DB" });
    const orphans = (await readOrphans()).map(item => item.resourceId);
    expect(orphans).toContain("proj-paid-db"); expect(orphans).not.toContain("proj-free-db");
    expect((await readUsedBy())["proj-free-db"]).toEqual([expect.objectContaining({ slug: "integration-app" })]);
  });

  it("syncs gitops links, remembers rejections and confirmations, and marks unseen links stale", async () => {
    await queryClient`UPDATE resources SET name = 'integration-app-cache' WHERE id = 'proj-free-db'`;
    const manifest = `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: integration-app\n  annotations:\n    fleethub.dev/uses: "proj-paid-db"\nspec: {}\n`;
    const first = await syncProjectFromFiles(projectId, [{ path: "app/deploy.yaml", content: manifest }]);
    expect(first).toMatchObject({ gitops: 1, inferred: 1, suggested: 1 });
    const rows = await queryClient`SELECT resource_id, source, status, confidence FROM project_resource_links WHERE project_id = ${projectId} AND source IN ('gitops','inferred') ORDER BY source`;
    expect(rows).toEqual([{ resource_id: "proj-paid-db", source: "gitops", status: "in_use", confidence: 1 }, { resource_id: "proj-free-db", source: "inferred", status: "suggested", confidence: 0.35 }]);
    expect(await decideLink(projectId, "proj-free-db", "reject", "test")).toBe(true);
    const second = await syncProjectFromFiles(projectId, [{ path: "app/deploy.yaml", content: manifest }]);
    expect(second).toMatchObject({ rejectedSkipped: 1, suggested: 0 });
    await decideLink(projectId, "proj-free-db", "clear", "test");
    await syncProjectFromFiles(projectId, [{ path: "app/deploy.yaml", content: manifest }]);
    await decideLink(projectId, "proj-free-db", "confirm", "test");
    const [confirmed] = await queryClient`SELECT status, confidence FROM project_resource_links WHERE project_id = ${projectId} AND resource_id = 'proj-free-db' AND source = 'inferred'`;
    expect(confirmed).toEqual({ status: "in_use", confidence: 1 });
    const third = await syncProjectFromFiles(projectId, [{ path: "app/empty.yaml", content: "kind: ConfigMap\nmetadata: { name: x }\n" }]);
    expect(third.markedStale).toBe(1);
    const [gone] = await queryClient`SELECT status FROM project_resource_links WHERE project_id = ${projectId} AND resource_id = 'proj-paid-db' AND source = 'gitops'`;
    expect(gone.status).toBe("stale");
    const [declared] = await queryClient`SELECT status FROM project_resource_links WHERE project_id = ${projectId} AND source = 'declared'`;
    expect(declared.status).toBe("in_use");
  });

  it("registers discovered projects idempotently with host-resolved placements and never overwrites names", async () => {
    await queryClient`INSERT INTO resources (id,name,category,provider,account_email,state) VALUES ('disc-host','Borealis','compute','oracle','a@x.test','online') ON CONFLICT DO NOTHING`;
    const files = [
      { path: "clusters/borealis/kustomization.yaml", content: "resources:\n  - ../../apps/discshop\n" },
      { path: "apps/discshop/app.yaml", content: "apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: discshop }\nspec:\n  replicas: 1\n  template:\n    spec:\n      containers:\n        - name: a\n          image: x/y:1\n          resources:\n            requests: { cpu: 100m, memory: 64Mi }\n" },
    ];
    const first = await applyDiscovery(files, ["discshop"], "test repo");
    expect(first).toMatchObject({ created: 1, updated: 0, placements: 1, unresolvedHosts: [] });
    await queryClient`UPDATE projects SET name = 'My renamed shop' WHERE slug = 'discshop'`;
    const second = await applyDiscovery(files, ["discshop"], "test repo");
    expect(second).toMatchObject({ created: 0, updated: 1 });
    const [row] = await queryClient`SELECT p.name, p.kind, p.source, pl.host_name, pl.host_resource_id, pl.declared FROM projects p JOIN project_placements pl ON pl.project_id = p.id WHERE p.slug = 'discshop'`;
    expect(row).toMatchObject({ name: "My renamed shop", kind: "service", source: "flux", host_name: "borealis", host_resource_id: "disc-host" });
    expect(row.declared).toMatchObject({ cpuRequestMilli: 100, memRequestMi: 64 });
    const [footprint] = await readFootprints("discshop");
    expect(footprint).toMatchObject({ kind: "service" }); expect(footprint.placements[0]).toMatchObject({ host: "borealis", hostResourceId: "disc-host" });
    await queryClient`DELETE FROM projects WHERE slug = 'discshop'`; await queryClient`DELETE FROM resources WHERE id = 'disc-host'`;
  });

  it("keeps identical namespace names on two hosts separate in reports, footprints and host project rows", async () => {
    const project = await createProject({ slug: "metrics-demo", name: "Metrics", environment: "prod", criticality: "normal" }, null);
    try {
      await queryClient`INSERT INTO resources (id,name,category,provider,account_email,state) VALUES
        ('metrics-a','metrics-a','compute','oracle','test@example.test','online'),
        ('metrics-b','metrics-b','compute','oracle','test@example.test','online')`;
      await queryClient`INSERT INTO project_placements (id, project_id, host_name, host_resource_id, runtime, source, evidence, scope) VALUES
        ('metrics-pl-a',${project.id},'metrics-a','metrics-a','k8s','k8s','test','db'),
        ('metrics-pl-b',${project.id},'metrics-b','metrics-b','k8s','k8s','test','db')`;
      const usage = [
        { instance: "metrics-a:10250", kind: "namespace" as const, scope: "db", cpuCores: 0.2, memMi: 100 },
        { instance: "metrics-b:10250", kind: "namespace" as const, scope: "db", cpuCores: 0.8, memMi: 400 },
      ];
      expect(await recordMeasuredUsage("metrics-source", usage)).toBe(2);
      expect(await recordMeasuredUsage("metrics-source", usage)).toBe(0);
      const [footprint] = await readFootprints("metrics-demo");
      expect(footprint.measuredUsage).toEqual(expect.arrayContaining([
        expect.objectContaining({ hostRef: "host:metrics-a", cpuCores: 0.2, memMi: 100 }),
        expect.objectContaining({ hostRef: "host:metrics-b", cpuCores: 0.8, memMi: 400 }),
      ]));
      await queryClient`UPDATE resources SET name = 'METRICS-A' WHERE id = 'metrics-a'`;
      const capacities = await readHostCapacities();
      const a = capacities.find(host => host.hostId === "metrics-a")!.projects[0];
      const b = capacities.find(host => host.hostId === "metrics-b")!.projects[0];
      expect(a.measuredUsage).toHaveLength(1); expect(a.measuredUsage[0].cpuCores).toBe(0.2);
      expect(b.measuredUsage).toHaveLength(1); expect(b.measuredUsage[0].cpuCores).toBe(0.8);
    } finally {
      await queryClient`DELETE FROM projects WHERE id = ${project.id}`;
      await queryClient`DELETE FROM resources WHERE id IN ('metrics-a','metrics-b')`;
    }
  });

  it("registers live cluster projects, infers zones from ingress hosts, and records measured usage once per quarter hour", async () => {
    await queryClient`INSERT INTO resources (id,name,category,provider,account_email,state) VALUES ('live-zone','livedemo.test','network','cloudflare','a@x.test','online') ON CONFLICT DO NOTHING`;
    const dep = { kind: "Deployment", metadata: { name: "web", namespace: "livedemo" }, spec: { replicas: 1, template: { spec: { containers: [{ name: "w", image: "x/y:1", resources: { requests: { cpu: "100m", memory: "64Mi" } } }] } } } };
    const discovery = normalizeCluster("livecluster", { deployments: [dep], statefulSets: [], ingresses: [{ kind: "Ingress", metadata: { name: "web", namespace: "livedemo" }, spec: { rules: [{ host: "www.livedemo.test" }] } }], pvcs: [] });
    const summary = await applyProposal(discovery, ["livedemo"], "kubernetes test");
    expect(summary).toMatchObject({ created: 1, placements: 1 }); expect(summary.links.suggested).toBeGreaterThanOrEqual(1);
    const [link] = await queryClient`SELECT l.source, l.status FROM project_resource_links l JOIN projects p ON p.id = l.project_id WHERE p.slug = 'livedemo' AND l.resource_id = 'live-zone'`;
    expect(link).toEqual({ source: "inferred", status: "suggested" });
    const [placement] = await queryClient`SELECT scope, runtime FROM project_placements pl JOIN projects p ON p.id = pl.project_id WHERE p.slug = 'livedemo'`;
    expect(placement).toEqual({ scope: "livedemo", runtime: "k8s" });
    expect(await recordMeasuredUsage("conn-test", [{ scope: "livedemo", instance: "livecluster:10250", kind: "namespace", cpuCores: 0.12, memMi: 80 }, { scope: "nothing-matches", instance: "livecluster:10250", kind: "namespace", cpuCores: 1, memMi: 1 }])).toBe(1);
    expect(await recordMeasuredUsage("conn-test", [{ scope: "livedemo", instance: "livecluster:10250", kind: "namespace", cpuCores: 0.12, memMi: 80 }])).toBe(0);
    const [usage] = await queryClient`SELECT amount, unit, metrics FROM project_usage_reports u JOIN projects p ON p.id = u.project_id WHERE p.slug = 'livedemo'`;
    expect(usage).toMatchObject({ amount: 0.12, unit: "cores", metrics: { cpuCores: 0.12, memMi: 80 } });
    await queryClient`DELETE FROM projects WHERE slug = 'livedemo'`; await queryClient`DELETE FROM resources WHERE id = 'live-zone'`;
  });

  it("keeps a manual reclassification across rescans until the owner hands it back, and registers everything with a select-all", async () => {
    const files = [
      { path: "clusters/c1/kustomization.yaml", content: "resources:\n  - ../../apps/kindtest\n  - ../../apps/kindtwo\n" },
      { path: "apps/kindtest/a.yaml", content: "apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: kindtest }\nspec:\n  replicas: 1\n  template:\n    spec:\n      containers:\n        - { name: a, image: x/y:1 }\n" },
      { path: "apps/kindtwo/a.yaml", content: "apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: kindtwo }\nspec:\n  replicas: 1\n  template:\n    spec:\n      containers:\n        - { name: a, image: x/z:1 }\n" },
    ];
    const first = await applyDiscovery(files, ["*"], "test");
    expect(first).toMatchObject({ created: 2 });
    const [{ id }] = await queryClient`SELECT id FROM projects WHERE slug = 'kindtest'`;
    expect(await updateProject({ projectId: String(id), kind: "platform" })).toBe(true);
    await applyDiscovery(files, ["*"], "test");
    const [locked] = await queryClient`SELECT kind, kind_manual FROM projects WHERE slug = 'kindtest'`;
    expect(locked).toEqual({ kind: "platform", kind_manual: true });
    const [other] = await queryClient`SELECT kind, kind_manual FROM projects WHERE slug = 'kindtwo'`;
    expect(other).toEqual({ kind: "service", kind_manual: false });
    expect(await updateProject({ projectId: String(id), kind: "auto" })).toBe(true);
    expect((await queryClient`SELECT kind FROM projects WHERE slug = 'kindtest'`)[0]).toEqual({ kind: "service" });
    await applyDiscovery(files, ["*"], "test");
    const [back] = await queryClient`SELECT kind, kind_manual FROM projects WHERE slug = 'kindtest'`;
    expect(back).toEqual({ kind: "service", kind_manual: false });
    expect(await updateProject({ projectId: String(id), name: "Renamed" })).toBe(true);
    expect(await updateProject({ projectId: "prj-00000000-0000-0000-0000-000000000000", kind: "app" })).toBe(false);
    await queryClient`DELETE FROM projects WHERE slug IN ('kindtest','kindtwo')`;
  });
});
