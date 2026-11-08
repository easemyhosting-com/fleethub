import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { z } from "zod";
import type { ClusterSnapshot } from "./kubernetes";
import type { DockerSnapshot } from "./docker";
import { samplesFrom, usageQueries, type PromSample, type UsageQueryName } from "./prometheus";

export class ConnectorError extends Error { constructor(readonly code: "invalid_url" | "unauthorized" | "forbidden" | "not_found" | "unavailable" | "too_large" | "invalid_response") { super(code); } }

export const connectorKinds = ["kubernetes", "docker", "prometheus"] as const;
export type ConnectorKind = (typeof connectorKinds)[number];
export const connectorConfig = z.strictObject({
  kind: z.enum(connectorKinds),
  label: z.string().trim().min(1).max(80),
  hostName: z.string().trim().regex(/^[A-Za-z0-9_.-]{1,80}$/),
  url: z.url().max(300),
  allowHttp: z.boolean().default(false),
  caPem: z.string().max(20_000).refine(value => value === "" || /^-----BEGIN CERTIFICATE-----/.test(value.trim())).optional(),
  basicUser: z.string().max(100).optional(),
});
export type ConnectorConfig = z.infer<typeof connectorConfig>;

const maxBytes = 8 * 1024 * 1024;
/** Operator-supplied URLs only; refuse non-http(s), credentials in the URL, and cloud metadata addresses. */
export function checkUrl(raw: string, allowHttp: boolean): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ConnectorError("invalid_url"); }
  if (url.username || url.password) throw new ConnectorError("invalid_url");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && allowHttp)) throw new ConnectorError("invalid_url");
  if (/^169\.254\./.test(url.hostname) || url.hostname === "metadata.google.internal") throw new ConnectorError("invalid_url");
  return url;
}

/** GET only. Redirects are not followed, the body is size-bounded, and a self-signed cluster CA can be supplied instead of disabling verification. */
export function getJson(base: URL, path: string, init: { token?: string; basicUser?: string; ca?: string; timeoutMs?: number }): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    if (url.origin !== base.origin) return reject(new ConnectorError("invalid_url"));
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.token) headers.Authorization = init.basicUser ? `Basic ${Buffer.from(`${init.basicUser}:${init.token}`).toString("base64")}` : `Bearer ${init.token}`;
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, { method: "GET", headers, ca: init.ca || undefined, timeout: init.timeoutMs ?? 10_000 }, res => {
      const status = res.statusCode ?? 0;
      if (status === 401) { res.resume(); return reject(new ConnectorError("unauthorized")); }
      if (status === 403) { res.resume(); return reject(new ConnectorError("forbidden")); }
      if (status === 404) { res.resume(); return reject(new ConnectorError("not_found")); }
      if (status < 200 || status >= 300) { res.resume(); return reject(new ConnectorError("unavailable")); }
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) { req.destroy(); reject(new ConnectorError("too_large")); } else chunks.push(chunk); });
      res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new ConnectorError("invalid_response")); } });
    });
    req.on("timeout", () => { req.destroy(); reject(new ConnectorError("unavailable")); });
    req.on("error", () => reject(new ConnectorError("unavailable")));
    req.end();
  });
}

async function listAll(base: URL, path: string, init: Parameters<typeof getJson>[2], optional: boolean): Promise<any[] | undefined> {
  const items: any[] = []; let token = "";
  for (let page = 0; page < 20; page += 1) {
    const sep = path.includes("?") ? "&" : "?";
    try {
      const body = await getJson(base, `${path}${sep}limit=500${token ? `&continue=${encodeURIComponent(token)}` : ""}`, init) as any;
      items.push(...(Array.isArray(body?.items) ? body.items : []));
      token = body?.metadata?.continue ?? "";
      if (!token) return items;
    } catch (error) {
      if (optional && error instanceof ConnectorError && (error.code === "not_found" || error.code === "forbidden")) return undefined;
      throw error;
    }
  }
  throw new ConnectorError("too_large");
}

/** Read-only list calls. Core workloads are required; CD tool objects are optional (a cluster without Argo CD simply has none). Secrets are never requested. */
export async function fetchClusterSnapshot(config: ConnectorConfig, token: string): Promise<ClusterSnapshot> {
  const base = checkUrl(config.url, config.allowHttp);
  const init = { token, ca: config.caPem };
  const [deployments, statefulSets, daemonSets, ingresses, pvcs, fluxKustomizations, fluxHelmReleases, argoApplications] = await Promise.all([
    listAll(base, "/apis/apps/v1/deployments", init, false), listAll(base, "/apis/apps/v1/statefulsets", init, false), listAll(base, "/apis/apps/v1/daemonsets", init, true),
    listAll(base, "/apis/networking.k8s.io/v1/ingresses", init, true), listAll(base, "/api/v1/persistentvolumeclaims", init, true),
    listAll(base, "/apis/kustomize.toolkit.fluxcd.io/v1/kustomizations", init, true), listAll(base, "/apis/helm.toolkit.fluxcd.io/v2/helmreleases", init, true),
    listAll(base, "/apis/argoproj.io/v1alpha1/applications", init, true),
  ]);
  const kind = (items: any[] | undefined, value: string) => items?.map(item => ({ ...item, kind: item?.kind ?? value }));
  return {
    deployments: kind(deployments, "Deployment") ?? [], statefulSets: kind(statefulSets, "StatefulSet") ?? [], daemonSets: kind(daemonSets, "DaemonSet"),
    ingresses: kind(ingresses, "Ingress") ?? [], pvcs: kind(pvcs, "PersistentVolumeClaim") ?? [], fluxKustomizations, fluxHelmReleases, argoApplications,
  };
}

/** Container list plus HostConfig limits only; env and mounts from inspect are discarded here and never leave this function. */
export async function fetchDockerSnapshot(config: ConnectorConfig, token: string | undefined): Promise<DockerSnapshot> {
  const base = checkUrl(config.url, config.allowHttp);
  const init = { token, ca: config.caPem };
  const containers = await getJson(base, "/containers/json?all=1", init);
  if (!Array.isArray(containers)) throw new ConnectorError("invalid_response");
  const inspect: Record<string, { HostConfig: { NanoCpus?: number; Memory?: number; MemoryReservation?: number } }> = {};
  for (const c of containers.filter(item => item?.State === "running" && typeof item?.Id === "string").slice(0, 200)) {
    try { const full = await getJson(base, `/containers/${encodeURIComponent(c.Id)}/json`, init) as any; inspect[c.Id] = { HostConfig: { NanoCpus: full?.HostConfig?.NanoCpus, Memory: full?.HostConfig?.Memory, MemoryReservation: full?.HostConfig?.MemoryReservation } }; } catch { /* limits stay unknown */ }
  }
  return { containers: containers.map(c => ({ Id: c?.Id, Names: c?.Names, Image: c?.Image, State: c?.State, Labels: c?.Labels })), inspect };
}

export async function queryPrometheus(config: ConnectorConfig, token: string | undefined, names: UsageQueryName[]): Promise<Record<string, PromSample[]>> {
  const base = checkUrl(config.url, config.allowHttp);
  const out: Record<string, PromSample[]> = {};
  const prefix = base.pathname.replace(/\/+$/, "");
  for (const name of names) {
    try { out[name] = samplesFrom(await getJson(base, `${prefix}/api/v1/query?query=${encodeURIComponent(usageQueries[name])}`, { token, basicUser: config.basicUser, ca: config.caPem })); }
    catch (error) { if (error instanceof ConnectorError && ["unauthorized", "forbidden", "invalid_url"].includes(error.code)) throw error; out[name] = []; }
  }
  return out;
}
