import { describe, expect, it } from "vitest";
import { attributeContainers, attributeScopes, joinUsage, metricMachine, usageQueries, type ScopeUsage } from "../src/lib/connectors/prometheus";
import { InvalidConnectorHost, resolveConnectorHost } from "../src/lib/connectors/hosts";
const hosts = [{ instance: "10.0.0.1:9100", nodeName: "borealis", cpuCores: 2, cpuBusyCores: 1, memTotalMi: 12, memUsedMi: 4 }];
const reading = (instance: string, scope = "databases", cpuCores: number | null = 0.1): ScopeUsage => ({ scope, instance, kind: "namespace", cpuCores, memMi: 100 });
const placements = [
  { projectId: "same", hostName: "borealis", resourceId: "a", runtime: "k8s", scope: "databases,cache" },
  { projectId: "same", hostName: "pno", resourceId: "b", runtime: "k8s", scope: "databases" },
];
describe("metrics scoped to a machine", () => {
  it("retains separate namespace samples and matches memory only to the same machine", () => {
    const sample = (instance: string, value: number) => ({ labels: { instance, namespace: "db" }, value });
    expect(joinUsage([sample("a", 0.2), sample("b", 0.4)], [sample("a", 1048576)], "namespace")).toEqual([
      { scope: "db", instance: "a", kind: "namespace", cpuCores: 0.2, memMi: 1 },
      { scope: "db", instance: "b", kind: "namespace", cpuCores: 0.4, memMi: null },
    ]);
    expect(usageQueries.cpuCoresByNamespace).toContain("sum by (instance, namespace)");
    expect(usageQueries.memBytesByNamespace).toContain("max by (instance, namespace, pod, container)");
    expect(usageQueries.cpuCoresByComposeProject).toContain("instance, container_label_com_docker_compose_project");
  });
  it("records one project on two machines separately and aggregates only that project's scopes on each host", () => {
    expect(attributeScopes([reading("10.0.0.1:10250"), reading("pno:10250"), reading("borealis", "cache", 0.2)], placements, hosts)).toEqual([
      { projectId: "same", hostName: "borealis", resourceId: "a", kind: "namespace", scopes: ["databases", "cache"], cpuCores: 0.3, memMi: 200 },
      { projectId: "same", hostName: "pno", resourceId: "b", kind: "namespace", scopes: ["databases"], cpuCores: 0.1, memMi: 100 },
    ]);
  });
  it("omits shared namespaces, missing instances and ambiguous host spellings", () => {
    expect(attributeScopes([reading("borealis")], [...placements, { ...placements[0], projectId: "another" }], hosts)).toEqual([]);
    expect(attributeScopes([reading("")], placements, hosts)).toEqual([]);
    expect(attributeScopes([reading("bore-alis")], [...placements, { ...placements[0], projectId: "another", hostName: "bore-alis" }], hosts)).toEqual([]);
    expect(attributeScopes([reading("10.0.0.1:10250")], placements, [...hosts, { ...hosts[0], nodeName: "elsewhere" }])).toEqual([]);
    expect(metricMachine("", hosts)).toBeNull();
  });
  it("does not mix runtimes or attribute the same host scope twice", () => {
    expect(attributeScopes([{ ...reading("borealis"), kind: "compose" }], placements, hosts)).toEqual([]);
    expect(attributeScopes([reading("borealis"), reading("10.0.0.1:10250")], placements, hosts)).toEqual([]);
    expect(attributeScopes([{ ...reading("borealis", "cache", null), memMi: null }], placements, hosts)[0]).toMatchObject({ cpuCores: null, memMi: null });
    expect(attributeScopes([{ ...reading("atlas", "db"), kind: "compose" }], [{ ...placements[0], hostName: "atlas", runtime: "compose", scope: "db" }])[0]).toMatchObject({ hostName: "atlas", kind: "compose" });
  });
});
it("resolves only one known compute resource and rejects aliases and collisions", () => {
  expect(resolveConnectorHost("Polar_Night_Owl", [{ name: "polar-night-owl" }])).toBe("polar-night-owl");
  expect(() => resolveConnectorHost("pno", [{ name: "polar-night-owl" }])).toThrow(InvalidConnectorHost);
  expect(() => resolveConnectorHost("web1", [{ name: "web-1" }, { name: "web1" }])).toThrow(/multiple/);
});

it("keeps partially missing metrics unknown and omits containers that could belong to two projects", () => {
  expect(attributeScopes([reading("borealis"), { ...reading("borealis", "cache", null), memMi: 5 }], placements)[0]).toMatchObject({ cpuCores: null, memMi: 105 });
  const p = { projectId: "p", hostName: "atlas", resourceId: null, slug: "api" };
  const c = { instance: "atlas", name: "api-worker", cpuCores: 0.5, memMi: null };
  expect(attributeContainers([c], [p, { ...p, projectId: "other", slug: "api-worker" }])).toEqual([]);
  expect(attributeContainers([c], [p])[0]).toMatchObject({ cpuCores: 0.5, memMi: null });
});
