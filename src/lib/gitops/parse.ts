import { parseAllDocuments } from "yaml";
import { z } from "zod";

export const maxFiles = 200;
export const maxFileBytes = 200 * 1024;
export const maxTotalBytes = 2 * 1024 * 1024;

export interface GitopsFile { path: string; content: string }
export interface WorkloadFact { kind: string; name: string; namespace: string | null; hosts: string[]; images: string[]; uses: string[]; file: string }
export interface Declaration { uses: Array<{ resource: string; purpose?: string }>; file: string }
export interface ParsedRepo { workloads: WorkloadFact[]; declarations: Declaration[]; skipped: Array<{ path: string; reason: string }> }

const ref = z.string().regex(/^[A-Za-z0-9_.:\/-]{1,256}$/);
const declarationSchema = z.strictObject({
  project: z.string().regex(/^[a-z][a-z0-9-]{1,38}$/).optional(),
  uses: z.array(z.strictObject({ resource: ref, purpose: z.string().trim().min(1).max(200).optional() })).max(100).default([]),
});
const text = z.string().max(300);
const strings = (value: unknown, limit = 50): string[] => (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string" && item.length <= 300).slice(0, limit);

/** Files whose names suggest credentials are never read, whatever they contain. */
export const isSecretLikePath = (path: string) => /(secret|sealed|credential|token|password|\.pem$|\.key$|\.crt$|\.p12$|(^|\/)\.env)/i.test(path);

const safePath = (path: string) => /^[A-Za-z0-9_.\/-]{1,300}$/.test(path) && !path.split("/").includes("..") && !path.startsWith("/");

function containerImages(spec: any): string[] {
  const pod = spec?.template?.spec ?? spec?.jobTemplate?.spec?.template?.spec ?? spec;
  const all = [...(Array.isArray(pod?.containers) ? pod.containers : []), ...(Array.isArray(pod?.initContainers) ? pod.initContainers : [])];
  return all.map((container: any) => container?.image).filter((image: unknown): image is string => typeof image === "string").slice(0, 20);
}

/**
 * Reads Kubernetes and Flux manifests plus an optional fleethub.yaml. Pure and bounded: size and file limits, alias limit, no tags executed,
 * and anything that does not parse is reported as skipped rather than trusted. Nothing here fetches or runs anything.
 */
export function parseRepo(files: GitopsFile[], expectedProject?: string): ParsedRepo {
  const out: ParsedRepo = { workloads: [], declarations: [], skipped: [] };
  let total = 0;
  for (const file of files.slice(0, maxFiles)) {
    if (isSecretLikePath(file.path)) { out.skipped.push({ path: file.path, reason: "secret-like name, not read" }); continue; }
    if (!safePath(file.path)) { out.skipped.push({ path: file.path.slice(0, 80), reason: "unsafe path" }); continue; }
    const size = Buffer.byteLength(file.content);
    total += size;
    if (size > maxFileBytes) { out.skipped.push({ path: file.path, reason: "file too large" }); continue; }
    if (total > maxTotalBytes) { out.skipped.push({ path: file.path, reason: "total size limit" }); continue; }
    if (!/\.ya?ml$/i.test(file.path)) { out.skipped.push({ path: file.path, reason: "not yaml" }); continue; }
    const isDeclaration = /(^|\/)fleethub\.ya?ml$/i.test(file.path);
    for (const doc of parseAllDocuments(file.content, { strict: true, uniqueKeys: true })) {
      if (doc.errors.length) { out.skipped.push({ path: file.path, reason: "yaml error" }); continue; }
      let value: any;
      try { value = doc.toJS({ maxAliasCount: 20 }); } catch { out.skipped.push({ path: file.path, reason: "yaml too complex" }); continue; }
      if (!value || typeof value !== "object") continue;
      if (isDeclaration) {
        const parsed = declarationSchema.safeParse(value);
        if (!parsed.success) { out.skipped.push({ path: file.path, reason: "invalid fleethub.yaml" }); continue; }
        if (expectedProject && parsed.data.project && parsed.data.project !== expectedProject) { out.skipped.push({ path: file.path, reason: "declares a different project" }); continue; }
        out.declarations.push({ uses: parsed.data.uses, file: file.path });
        continue;
      }
      if (typeof value.kind !== "string" || typeof value.metadata?.name !== "string") continue;
      const spec = value.spec ?? {};
      const hosts = [
        ...(Array.isArray(spec.rules) ? spec.rules.map((rule: any) => rule?.host) : []),
        ...strings(spec.hostnames), ...strings(spec.dnsNames), ...(typeof spec.host === "string" ? [spec.host] : []),
      ].filter((host: unknown): host is string => typeof host === "string" && /^[A-Za-z0-9*.-]{1,253}$/.test(host)).slice(0, 20);
      const annotation = value.metadata?.annotations?.["fleethub.dev/uses"];
      const uses = typeof annotation === "string" ? annotation.split(",").map((item: string) => item.trim()).filter(item => ref.safeParse(item).success).slice(0, 20) : [];
      out.workloads.push({ kind: text.parse(value.kind), name: text.parse(value.metadata.name), namespace: typeof value.metadata.namespace === "string" ? value.metadata.namespace.slice(0, 63) : null, hosts, images: containerImages(spec), uses, file: file.path });
    }
  }
  return out;
}
