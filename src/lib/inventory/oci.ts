import { createSign } from "node:crypto";
import { z } from "zod";
import { CollectionError, type ResourceFact } from "./model";
import { ociPlan, ociShapeBilling, type DetectedPlan } from "./plans";

const ocid = (kind: string) => z.string().regex(new RegExp(`^ocid1\\.${kind}\\.[A-Za-z0-9._-]{1,200}$`));
export const ociConfigSchema = z.strictObject({
  tenancyId: ocid("tenancy"),
  userId: ocid("user"),
  fingerprint: z.string().regex(/^([0-9a-f]{2}:){15}[0-9a-f]{2}$/i),
  region: z.string().regex(/^[a-z]{2}-[a-z]+-\d{1,2}$/),
  privateKey: z.string().min(100).max(8192).refine(pem => /-----BEGIN (RSA )?PRIVATE KEY-----/.test(pem) && !/ENCRYPTED/.test(pem), "Use an unencrypted PEM private key"),
});
export type OciConfig = z.infer<typeof ociConfigSchema>;

const maxPages = 20;
const maxCalls = 120;
const maxBytes = 1024 * 1024;
const maxCompartments = 50;

type Auth = OciConfig;
type Call = { count: number };

/** Signs a GET with the account's API key (HTTP signature, rsa-sha256) as Oracle requires. */
export function signGet(auth: Auth, host: string, target: string, date: string): string {
  const signingString = `(request-target): get ${target}\nhost: ${host}\ndate: ${date}`;
  const signature = createSign("RSA-SHA256").update(signingString).sign(auth.privateKey, "base64");
  return `Signature version="1",keyId="${auth.tenancyId}/${auth.userId}/${auth.fingerprint}",algorithm="rsa-sha256",headers="(request-target) host date",signature="${signature}"`;
}

async function get(auth: Auth, service: string, path: string, params: Record<string, string>, signal: AbortSignal, calls: Call): Promise<{ body: unknown; next: string | null }> {
  if (++calls.count > maxCalls) throw new CollectionError("scan_limit");
  const host = `${service}.${auth.region}.oraclecloud.com`;
  const query = new URLSearchParams(params).toString();
  const target = query ? `${path}?${query}` : path;
  const date = new Date().toUTCString();
  let authorization: string;
  try { authorization = signGet(auth, host, target, date); }
  catch { throw new CollectionError("invalid_config"); }
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  try {
    const response = await fetch(`https://${host}${target}`, { method: "GET", headers: { Authorization: authorization, Date: date, Accept: "application/json" }, redirect: "error", signal: requestSignal });
    // Oracle answers 404 NotAuthorizedOrNotFound for a missing policy, so 404 counts as no access.
    if ([401, 403, 404].includes(response.status)) { await response.body?.cancel(); throw new CollectionError("unauthorized"); }
    if (response.status === 429) { await response.body?.cancel(); throw new CollectionError("rate_limited"); }
    if (!response.ok) { await response.body?.cancel(); throw new CollectionError("provider_unavailable"); }
    if (Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); throw new CollectionError("scan_limit"); }
    const text = await response.text();
    if (text.length > maxBytes) throw new CollectionError("scan_limit");
    return { body: JSON.parse(text), next: response.headers.get("opc-next-page") };
  } catch (error) {
    if (error instanceof CollectionError) throw error;
    if (requestSignal.aborted) throw new CollectionError("scan_timeout");
    if (error instanceof SyntaxError) throw new CollectionError("invalid_response");
    throw new CollectionError("provider_unavailable");
  }
}

function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new CollectionError("invalid_response");
  return result.data;
}

async function list<T>(auth: Auth, service: string, path: string, params: Record<string, string>, schema: z.ZodType<T[]>, signal: AbortSignal, calls: Call): Promise<T[]> {
  const items: T[] = [];
  let page: string | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < maxPages; index++) {
    const { body, next } = await get(auth, service, path, { ...params, limit: "100", ...(page ? { page } : {}) }, signal, calls);
    items.push(...parsed(schema, body));
    if (!next) return items;
    if (seen.has(next)) throw new CollectionError("invalid_response");
    seen.add(next); page = next;
  }
  throw new CollectionError("scan_limit");
}

const name = z.string().min(1).max(256);
const compartmentSchema = z.array(z.object({ id: name, lifecycleState: z.string().optional() }));
const instanceSchema = z.array(z.object({
  id: name, displayName: name, lifecycleState: z.string(), shape: z.string().max(128), availabilityDomain: z.string().max(128).optional(),
  shapeConfig: z.object({ ocpus: z.number().nonnegative().optional(), memoryInGBs: z.number().nonnegative().optional() }).optional(),
}));
const volumeSchema = z.array(z.object({ id: name, displayName: name, lifecycleState: z.string(), sizeInGBs: z.number().nonnegative().optional() }));
const bucketSchema = z.array(z.object({ name }));
const adbSchema = z.array(z.object({ id: name, displayName: name, lifecycleState: z.string(), cpuCoreCount: z.number().nonnegative().optional(), dataStorageSizeInTBs: z.number().nonnegative().optional(), isFreeTier: z.boolean().optional() }));
const adSchema = z.array(z.object({ name }));

function instanceState(state: string): ResourceFact["state"] {
  if (state === "RUNNING") return "online";
  if (state === "STOPPED") return "offline";
  if (["STARTING", "STOPPING", "PROVISIONING", "CREATING_IMAGE", "MOVING"].includes(state)) return "busy";
  return "unknown";
}
function volumeState(state: string): ResourceFact["state"] { return state === "AVAILABLE" ? "online" : "unknown"; }

/** Shapes carry the compute limits that placement must respect: A1 draws on a shared free pool, micro shapes are fixed. */
export function computeSpec(shape: string, ocpus?: number, memoryGb?: number) {
  const arm = /\.A\d/i.test(shape);
  const capacityKind = /A1\.Flex/i.test(shape) ? "shared_pool" : /Micro/i.test(shape) ? "fixed" : "elastic";
  return { shape, arch: arm ? "arm64" : "x86_64", capacityKind, ...(ocpus !== undefined ? { ocpus } : {}), ...(memoryGb !== undefined ? { memoryGb } : {}) };
}

const console_ = (path: string, region: string) => `https://cloud.oracle.com/${path}?region=${encodeURIComponent(region)}`;

/** Read-only listing of one OCI tenancy and region. Compute is required; storage, databases and buckets are reported as not covered if the key cannot read them. */
export async function collectOci(config: unknown, signal: AbortSignal): Promise<{ scope: string; resources: ResourceFact[]; covered: string[]; plan: DetectedPlan }> {
  const auth = parsed(ociConfigSchema, config);
  const calls: Call = { count: 0 };
  const compartments = [auth.tenancyId];
  const children = await list(auth, "identity", "/20160918/compartments", { compartmentId: auth.tenancyId, compartmentIdInSubtree: "true", accessLevel: "ACCESSIBLE" }, compartmentSchema, signal, calls);
  for (const child of children) if (child.lifecycleState === undefined || child.lifecycleState === "ACTIVE") compartments.push(child.id);
  if (compartments.length > maxCompartments) throw new CollectionError("scan_limit");

  const resources: ResourceFact[] = [];
  const covered = ["instance"];
  const add = (fact: ResourceFact & { attributes?: Record<string, string | number | boolean | null> }) => { if (resources.length >= 1000) throw new CollectionError("scan_limit"); resources.push(fact); };

  for (const compartmentId of compartments) {
    for (const item of await list(auth, "iaas", "/20160918/instances", { compartmentId }, instanceSchema, signal, calls)) {
      if (["TERMINATED", "TERMINATING"].includes(item.lifecycleState)) continue;
      add({ nativeId: `instance:${item.id}`, name: item.displayName, category: "compute", region: auth.region, state: instanceState(item.lifecycleState), providerState: item.lifecycleState, product: "instance", billing: ociShapeBilling(item.shape), sourceUrl: console_(`compute/instances/${encodeURIComponent(item.id)}`, auth.region),
        attributes: { ...computeSpec(item.shape, item.shapeConfig?.ocpus, item.shapeConfig?.memoryInGBs), ...(item.availabilityDomain ? { availabilityDomain: item.availabilityDomain } : {}) } });
    }
  }

  const optional: { key: string; run: () => Promise<void> }[] = [
    { key: "volume", run: async () => {
      for (const compartmentId of compartments) for (const item of await list(auth, "iaas", "/20160918/volumes", { compartmentId }, volumeSchema, signal, calls)) {
        if (["TERMINATED", "TERMINATING"].includes(item.lifecycleState)) continue;
        add({ nativeId: `volume:${item.id}`, name: item.displayName, category: "storage", region: auth.region, state: volumeState(item.lifecycleState), providerState: item.lifecycleState, product: "volume", sourceUrl: console_(`block-storage/volumes/${encodeURIComponent(item.id)}`, auth.region), attributes: { sizeGb: item.sizeInGBs ?? null } });
      }
    } },
    { key: "bootvolume", run: async () => {
      const domains = await list(auth, "identity", "/20160918/availabilityDomains", { compartmentId: auth.tenancyId }, adSchema, signal, calls);
      for (const compartmentId of compartments) for (const domain of domains) for (const item of await list(auth, "iaas", "/20160918/bootVolumes", { compartmentId, availabilityDomain: domain.name }, volumeSchema, signal, calls)) {
        if (["TERMINATED", "TERMINATING"].includes(item.lifecycleState)) continue;
        add({ nativeId: `bootvolume:${item.id}`, name: item.displayName, category: "storage", region: auth.region, state: volumeState(item.lifecycleState), providerState: item.lifecycleState, product: "bootvolume", sourceUrl: console_(`block-storage/boot-volumes/${encodeURIComponent(item.id)}`, auth.region), attributes: { sizeGb: item.sizeInGBs ?? null } });
      }
    } },
    { key: "bucket", run: async () => {
      const namespace = parsed(z.string().min(1).max(256), (await get(auth, "objectstorage", "/n/", {}, signal, calls)).body);
      for (const compartmentId of compartments) for (const item of await list(auth, "objectstorage", `/n/${encodeURIComponent(namespace)}/b`, { compartmentId }, bucketSchema, signal, calls)) {
        add({ nativeId: `bucket:${namespace}/${item.name}`, name: item.name, category: "storage", region: auth.region, state: "online", providerState: "present", product: "bucket", sourceUrl: console_(`object-storage/buckets/${encodeURIComponent(namespace)}/${encodeURIComponent(item.name)}/objects`, auth.region) });
      }
    } },
    { key: "database", run: async () => {
      for (const compartmentId of compartments) for (const item of await list(auth, "database", "/20160918/autonomousDatabases", { compartmentId }, adbSchema, signal, calls)) {
        if (["TERMINATED", "TERMINATING"].includes(item.lifecycleState)) continue;
        add({ nativeId: `database:${item.id}`, name: item.displayName, category: "database", region: auth.region, state: item.lifecycleState === "AVAILABLE" ? "online" : item.lifecycleState === "STOPPED" ? "offline" : "unknown", providerState: item.lifecycleState, product: "database", ...(item.isFreeTier === undefined ? {} : { billing: item.isFreeTier ? "free_tier" as const : "billable" as const }), sourceUrl: console_(`db/autonomous-databases/${encodeURIComponent(item.id)}`, auth.region), attributes: { cpuCoreCount: item.cpuCoreCount ?? null, storageTb: item.dataStorageSizeInTBs ?? null, freeTier: item.isFreeTier ?? null } });
      }
    } },
  ];
  for (const product of optional) {
    const before = resources.length;
    try { await product.run(); covered.push(product.key); }
    catch (error) {
      resources.length = before;
      if (error instanceof CollectionError && error.code === "unauthorized") continue;
      throw error;
    }
  }
  return { scope: `oracle/tenancy/${auth.tenancyId}/${auth.region}`, resources, covered, plan: ociPlan(resources.map(resource => resource.billing)) };
}
