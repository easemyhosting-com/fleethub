import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkUrl, ConnectorError, connectorConfig, fetchClusterSnapshot, fetchDockerSnapshot, getJson, queryPrometheus } from "../src/lib/connectors/clients";

const seen: Array<{ method?: string; url?: string; auth?: string }> = [];
let server: Server; let base = "";
const cfg = (over: object = {}) => connectorConfig.parse({ kind: "kubernetes", label: "t", hostName: "h", url: base, allowHttp: true, ...over });

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    const url = new URL(req.url ?? "/", "http://x"); const send = (code: number, body: unknown) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); };
    if (url.pathname === "/redirect") { res.statusCode = 302; res.setHeader("location", "http://169.254.169.254/"); return res.end(); }
    if (url.pathname === "/apis/apps/v1/deployments") return url.searchParams.get("continue") ? send(200, { items: [{ metadata: { name: "b" } }] }) : send(200, { items: [{ metadata: { name: "a" } }], metadata: { continue: "tok" } });
    if (url.pathname === "/apis/apps/v1/statefulsets") return send(200, { items: [] });
    if (url.pathname === "/apis/apps/v1/daemonsets" || url.pathname === "/apis/networking.k8s.io/v1/ingresses" || url.pathname === "/api/v1/persistentvolumeclaims") return send(200, { items: [] });
    if (url.pathname.includes("fluxcd.io")) return send(404, {});
    if (url.pathname.includes("argoproj.io")) return send(403, {});
    if (url.pathname === "/containers/json") return send(200, [{ Id: "abc", Names: ["/x"], Image: "i:1", State: "running", Labels: { l: "v" }, Env: ["SECRET=1"] }]);
    if (url.pathname === "/containers/abc/json") return send(200, { HostConfig: { Memory: 1048576, NanoCpus: 1e9, Binds: ["/secret:/x"] }, Config: { Env: ["TOKEN=leak"] } });
    if (url.pathname === "/api/v1/query" || url.pathname === "/api/prom/api/v1/query") return send(200, { data: { result: [{ metric: { namespace: "n" }, value: [1, "2"] }] } });
    send(500, {});
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

describe("connector URL policy", () => {
  it("requires https unless http is explicitly allowed, and refuses credentials and metadata addresses", () => {
    expect(() => checkUrl("http://x.test", false)).toThrow(ConnectorError);
    expect(() => checkUrl("https://user:pw@x.test", false)).toThrow(ConnectorError);
    expect(() => checkUrl("https://169.254.169.254/latest", false)).toThrow(ConnectorError);
    expect(() => checkUrl("file:///etc/passwd", true)).toThrow(ConnectorError);
    expect(checkUrl("http://100.64.0.1:2375", true).port).toBe("2375");
  });
  it("rejects unknown fields and bad CA text in the config", () => {
    expect(connectorConfig.safeParse({ kind: "kubernetes", label: "t", hostName: "h", url: "https://x.test", extra: 1 }).success).toBe(false);
    expect(connectorConfig.safeParse({ kind: "kubernetes", label: "t", hostName: "h", url: "https://x.test", caPem: "not a cert" }).success).toBe(false);
  });
});

describe("read-only clients", () => {
  it("lists Kubernetes workloads with pagination, tolerates missing or forbidden CD CRDs, and only ever sends GET with the bearer token", async () => {
    seen.length = 0;
    const snapshot = await fetchClusterSnapshot(cfg(), "tok-123");
    expect(snapshot.deployments.map(item => item.metadata.name)).toEqual(["a", "b"]);
    expect(snapshot.deployments[0].kind).toBe("Deployment");
    expect(snapshot.fluxKustomizations).toBeUndefined(); expect(snapshot.argoApplications).toBeUndefined();
    expect(seen.every(item => item.method === "GET" && item.auth === "Bearer tok-123")).toBe(true);
    expect(seen.some(item => /secrets/.test(item.url ?? ""))).toBe(false);
  });
  it("returns only container metadata and HostConfig limits from Docker, never environment or binds", async () => {
    const snapshot = await fetchDockerSnapshot(cfg({ kind: "docker" }), undefined);
    expect(snapshot.containers[0]).toEqual({ Id: "abc", Names: ["/x"], Image: "i:1", State: "running", Labels: { l: "v" } });
    expect(snapshot.inspect?.abc).toEqual({ HostConfig: { NanoCpus: 1e9, Memory: 1048576, MemoryReservation: undefined } });
    expect(JSON.stringify(snapshot)).not.toMatch(/TOKEN|SECRET|Binds/);
  });
  it("queries Prometheus with fixed PromQL and maps results", async () => {
    const result = await queryPrometheus(cfg({ kind: "prometheus" }), "t", ["cpuCoresByNamespace"]);
    expect(result.cpuCoresByNamespace).toEqual([{ labels: { namespace: "n" }, value: 2 }]);
  });
  it("keeps the path of the Prometheus URL, as Grafana Cloud and datasource proxies need", async () => {
    seen.length = 0;
    const result = await queryPrometheus(cfg({ kind: "prometheus", url: `${base}/api/prom/` }), "t", ["cpuCoresByNamespace"]);
    expect(result.cpuCoresByNamespace).toHaveLength(1);
    expect(seen.at(-1)?.url).toMatch(/^\/api\/prom\/api\/v1\/query\?/);
  });
  it("does not follow redirects and maps failures to codes", async () => {
    await expect(getJson(new URL(base), "/redirect", {})).rejects.toMatchObject({ code: "unavailable" });
    await expect(getJson(new URL(base), "/nothing", {})).rejects.toMatchObject({ code: "unavailable" });
    await expect(getJson(new URL(base), "http://evil.test/x", {})).rejects.toMatchObject({ code: "invalid_url" });
  });
});
