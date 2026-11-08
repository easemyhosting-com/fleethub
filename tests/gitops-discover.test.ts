import { describe, expect, it } from "vitest";
import { composeMemMi, cpuMilli, discover, filesForProject, memMi } from "../src/lib/gitops/discover";

const f = (path: string, content: string) => ({ path, content });
const deployment = (name: string, extra = "") => `apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: ${name} }\nspec:\n  replicas: 2\n  template:\n    spec:\n      containers:\n        - name: ${name}\n          image: ghcr.io/acme/${name}:1.0\n          resources:\n            requests: { cpu: 50m, memory: 64Mi }\n            limits: { cpu: 200m, memory: 256Mi }\n${extra}`;
const ingress = (host: string) => `apiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata: { name: web }\nspec:\n  rules:\n    - host: ${host}\n`;
const repo = [
  f("clusters/borealis/kustomization.yaml", "resources:\n  - ../../base\n  - ../../apps/shop\n  - ../../apps/cert-manager\n  - ../../apps/db\n  # - ../../apps/old\n"),
  f("clusters/pno/kustomization.yaml", "resources:\n  - ../../apps/db\n  - arc.yaml\n"),
  f("clusters/pno/arc.yaml", "apiVersion: kustomize.toolkit.fluxcd.io/v1\nkind: Kustomization\nmetadata: { name: arc }\nspec:\n  path: ./apps/arc-runners\n"),
  f("clusters/borealis/flux-system/gotk-sync.yaml", "kind: Kustomization\nspec:\n  path: ./apps/should-be-ignored\n"),
  f("apps/shop/app.yaml", deployment("shop") + "---\n" + ingress("shop.example.com") + "---\napiVersion: v1\nkind: PersistentVolumeClaim\nmetadata: { name: data }\nspec:\n  resources:\n    requests: { storage: 2Gi }\n"),
  f("apps/cert-manager/cm.yaml", deployment("cm")),
  f("apps/db/db.yaml", deployment("db")),
  f("apps/arc-runners/r.yaml", deployment("runner")),
  f("apps/orphan-app/o.yaml", deployment("orphan")),
  f("apps/shop/shop-sealed-secret.yaml", "kind: SealedSecret\nmetadata: { name: x }\nspec: { encryptedData: { a: AgB } }\n"),
  f("sealed-secrets-key-pno.yaml", "BEGIN PRIVATE KEY not a real key"),
  f("servers/atlas/freellm/docker-compose.yml", "services:\n  api:\n    image: freellm/api:2\n    deploy:\n      resources:\n        limits: { cpus: '0.5', memory: 1G }\n  db:\n    image: postgres:17\n    mem_limit: 512m\n"),
];

describe("discover", () => {
  const result = discover(repo);
  const by = Object.fromEntries(result.projects.map(project => [project.slug, project]));
  it("finds hosts from clusters and servers", () => {
    expect(result.hosts).toEqual([{ name: "atlas", runtime: "compose" }, { name: "borealis", runtime: "flux" }, { name: "pno", runtime: "flux" }]);
  });
  it("places apps from cluster kustomizations and Flux Kustomization objects, ignoring comments and flux-system", () => {
    expect(by.shop.placements.map(p => p.host)).toEqual(["borealis"]);
    expect(by["arc-runners"].placements.map(p => p.host)).toEqual(["pno"]);
    expect(by.db.placements.map(p => p.host).sort()).toEqual(["borealis", "pno"]);
    expect(by["should-be-ignored"]).toBeUndefined();
  });
  it("classifies platform, app and service with a reason", () => {
    expect(by["cert-manager"].kind).toBe("platform"); expect(by["arc-runners"].kind).toBe("platform");
    expect(by.shop).toMatchObject({ kind: "app", domains: ["shop.example.com"] });
    expect(by.db.kind).toBe("service"); expect(by.freellm.kind).toBe("service");
    expect(by.shop.reason).toContain("shop.example.com");
  });
  it("sums declared requests and limits across replicas and PVCs", () => {
    expect(by.shop.placements[0].declared).toMatchObject({ replicas: 2, cpuRequestMilli: 100, cpuLimitMilli: 400, memRequestMi: 128, memLimitMi: 512, pvcGi: 2 });
    expect(by.freellm.placements[0].declared).toMatchObject({ containers: 2, cpuLimitMilli: 500, memLimitMi: 1024 + 512 });
  });
  it("reports defined-but-unplaced and multi-host placements", () => {
    expect(result.findings).toContainEqual({ type: "defined_but_unplaced", project: "orphan-app", detail: "apps/orphan-app exists but no cluster deploys it" });
    expect(result.findings.some(item => item.type === "placed_on_multiple_hosts" && item.project === "db")).toBe(true);
    expect(result.findings.some(item => item.project === "cert-manager")).toBe(false);
  });
  it("never reads secret-like files and says so", () => {
    expect(result.skipped.map(item => item.path).sort()).toEqual(["apps/shop/shop-sealed-secret.yaml", "sealed-secrets-key-pno.yaml"]);
    expect(filesForProject(repo, by.shop).map(file => file.path)).toEqual(["apps/shop/app.yaml"]);
  });
});

describe("quantities", () => {
  it("parses Compose binary units", () => { expect([composeMemMi("512m"), composeMemMi("1g"), composeMemMi("2GB"), composeMemMi("x")]).toEqual([512, 1024, 2048, 0]); });
  it("parses CPU and memory units", () => {
    expect([cpuMilli("200m"), cpuMilli("1"), cpuMilli(0.5), cpuMilli("bad")]).toEqual([200, 1000, 500, 0]);
    expect([memMi("256Mi"), memMi("1Gi"), memMi("2048Ki"), memMi("1G"), memMi(268435456), memMi("x")]).toEqual([256, 1024, 2, 954, 256, 0]);
  });
});
