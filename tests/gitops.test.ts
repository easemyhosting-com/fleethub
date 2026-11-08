import { describe, expect, it } from "vitest";
import { parseRepo } from "../src/lib/gitops/parse";
import { inferLinks, resolveResource, type KnownResource } from "../src/lib/gitops/infer";
import { isRepo } from "../src/lib/gitops/github";

const resources: KnownResource[] = [
  { id: "r-zone", name: "example.com", nativeId: "zone-1", provider: "cloudflare", category: "network" },
  { id: "r-kv", name: "shopfront-cache", nativeId: "kv:abc", provider: "cloudflare", category: "storage" },
  { id: "r-d1", name: "analytics", nativeId: "d1:uuid-1", provider: "cloudflare", category: "database" },
  { id: "r-d1b", name: "analytics", nativeId: "d1:uuid-2", provider: "cloudflare", category: "database" },
  { id: "r-vm", name: "borealis", nativeId: "ocid1.instance.x", provider: "oracle", category: "compute" },
];
const deployment = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: shopfront
  namespace: apps
  annotations:
    fleethub.dev/uses: "kv:abc, borealis"
spec:
  template:
    spec:
      containers:
        - image: ghcr.io/acme/shopfront:1.2
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: shopfront }
spec:
  rules:
    - host: shop.example.com
`;

describe("parseRepo", () => {
  it("reads workloads, hosts, images and the uses annotation from multi-document YAML", () => {
    const parsed = parseRepo([{ path: "apps/shopfront/deploy.yaml", content: deployment }]);
    expect(parsed.workloads.map(w => [w.kind, w.name])).toEqual([["Deployment", "shopfront"], ["Ingress", "shopfront"]]);
    expect(parsed.workloads[0]).toMatchObject({ namespace: "apps", uses: ["kv:abc", "borealis"], images: ["ghcr.io/acme/shopfront:1.2"] });
    expect(parsed.workloads[1].hosts).toEqual(["shop.example.com"]);
  });
  it("reads fleethub.yaml and rejects one that names another project or has unknown keys", () => {
    const ok = parseRepo([{ path: "apps/a/fleethub.yaml", content: "project: shopfront\nuses:\n  - resource: analytics\n    purpose: reporting\n" }], "shopfront");
    expect(ok.declarations[0].uses[0]).toEqual({ resource: "analytics", purpose: "reporting" });
    expect(parseRepo([{ path: "fleethub.yaml", content: "project: other\nuses: []\n" }], "shopfront").skipped[0].reason).toBe("declares a different project");
    expect(parseRepo([{ path: "fleethub.yaml", content: "uses: []\nrun: rm -rf /\n" }]).skipped[0].reason).toBe("invalid fleethub.yaml");
  });
  it("skips unsafe paths, non-YAML, oversized files and broken YAML instead of trusting them", () => {
    const parsed = parseRepo([
      { path: "../etc/passwd.yaml", content: "a: 1" }, { path: "/abs.yaml", content: "a: 1" }, { path: "readme.md", content: "# hi" },
      { path: "big.yaml", content: "a: " + "x".repeat(210 * 1024) }, { path: "bad.yaml", content: "a: [unclosed" },
    ]);
    expect(parsed.skipped.map(item => item.reason)).toEqual(["unsafe path", "unsafe path", "not yaml", "file too large", "yaml error"]);
    expect(parsed.workloads).toEqual([]);
  });
  it("is bounded against alias bombs", () => {
    const bomb = ["a: &a [1,1,1,1,1,1,1,1,1]", ...Array.from({ length: 30 }, (_, i) => `b${i}: *a`)].join("\n");
    expect(parseRepo([{ path: "bomb.yaml", content: bomb }]).skipped).toEqual([{ path: "bomb.yaml", reason: "yaml too complex" }]);
  });
});

describe("inferLinks", () => {
  const parsed = parseRepo([{ path: "apps/shopfront/deploy.yaml", content: deployment }, { path: "apps/shopfront/fleethub.yaml", content: "uses:\n  - resource: shopfront-cache\n" }]);
  it("ranks declared above host-derived above name guesses, each with evidence", () => {
    const links = inferLinks(parsed, resources, { slug: "shopfront" });
    const byId = Object.fromEntries(links.map(link => [`${link.resourceId}:${link.source}`, link]));
    expect(byId["r-kv:gitops"]).toMatchObject({ confidence: 1 });
    expect(byId["r-vm:gitops"].evidence).toContain("fleethub.dev/uses on Deployment shopfront");
    expect(byId["r-zone:inferred"]).toMatchObject({ confidence: 0.7 });
    expect(byId["r-zone:inferred"].evidence).toContain("shop.example.com");
    expect(byId["r-kv:inferred"]).toMatchObject({ confidence: 0.35 });
    expect(byId["r-kv:inferred"].evidence.startsWith("guess:")).toBe(true);
    expect(links[0].confidence).toBe(1);
  });
  it("does not guess from short slugs and does not resolve ambiguous names", () => {
    expect(inferLinks(parseRepo([]), resources, { slug: "app" })).toEqual([]);
    expect(resolveResource("analytics", resources)).toBeNull();
    expect(resolveResource("d1:uuid-2", resources)?.id).toBe("r-d1b");
    expect(resolveResource("BOREALIS", resources)?.id).toBe("r-vm");
  });
  it("validates repository names", () => {
    expect(isRepo("acme/gitops")).toBe(true);
    expect(isRepo("acme/../x")).toBe(false); expect(isRepo("a/b/c")).toBe(false); expect(isRepo("https://github.com/a/b")).toBe(false);
  });
});
