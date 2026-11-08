import { createHash } from "node:crypto";
import { z } from "zod";
import { collectOci, ociConfigSchema } from "./oci";
import { cfSubscriptions, cfZonePlan, cloudflarePlan, orgPlan, upstashBilling, upstashPlan, zoneIsFree, type DetectedPlan } from "./plans";
import { CollectionError, completeInventorySchema, resourceFactSchema, type CompleteInventory, type ResourceFact } from "./model";

const id = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9_.:-]+$/);
const secret = z.string().min(1).max(4096);
const configs = {
  cloudflare: z.strictObject({ apiToken: secret, accountId: id }),
  upstash: z.strictObject({ apiEmail: z.email(), apiKey: secret }),
  supabase: z.strictObject({ accessToken: secret, organizationId: id }),
  neon: z.strictObject({ apiKey: secret, organizationId: z.string().regex(/^[a-z0-9-]{1,60}$/) }),
  oracle: ociConfigSchema,
};
const cfName = z.string().min(1).max(256);
const cfInfo = z.object({ page: z.number().int().positive().optional(), total_pages: z.number().int().nonnegative().optional(), cursor: z.string().optional(), count: z.number().int().nonnegative().optional() });
const cfEnvelope = <T extends z.ZodType>(result: T) => z.object({ success: z.literal(true), result, result_info: cfInfo.optional() });
const cfWorkers = cfEnvelope(z.array(z.object({ id: cfName })));
const cfKv = cfEnvelope(z.array(z.object({ id, title: cfName })));
const cfD1 = cfEnvelope(z.array(z.object({ uuid: id, name: cfName })));
const cfR2 = cfEnvelope(z.object({ buckets: z.array(z.object({ name: cfName, location: z.string().optional() })) }));
const maxPages = 20;
const maxResources = 1000;
const maxBytes = 1024 * 1024;

export function supportsInventory(provider: string): boolean { return Object.hasOwn(configs, provider); }
function parseConfig(provider: string, config: unknown) {
  const schema = (() => {
    switch (provider) {
      case "cloudflare": return configs.cloudflare;
      case "upstash": return configs.upstash;
      case "supabase": return configs.supabase;
      case "neon": return configs.neon;
      case "oracle": return configs.oracle;
      default: throw new CollectionError("unsupported");
    }
  })();
  const result = schema.safeParse(config);
  if (!result.success) throw new CollectionError("invalid_config", [...new Set(result.error.issues.flatMap(issue => issue.path.length ? [String(issue.path[0])] : issue.code === "unrecognized_keys" ? issue.keys : []))]);
  return result.data;
}
export function validateInventoryConfig(provider: string, config: unknown): void { parseConfig(provider, config); }

async function getJson(url: string, authorization: string, signal: AbortSignal): Promise<unknown> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
  try {
    const response = await fetch(url, { method: "GET", headers: { Authorization: authorization, Accept: "application/json" }, redirect: "error", signal: requestSignal });
    if (response.status === 401 || response.status === 403) throw new CollectionError("unauthorized");
    if (response.status === 429) throw new CollectionError("rate_limited");
    if (!response.ok) throw new CollectionError("provider_unavailable");
    if (Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); throw new CollectionError("scan_limit"); }
    if (!response.body) throw new CollectionError("invalid_response");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new CollectionError("scan_limit"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
  } catch (error) {
    if (error instanceof CollectionError) throw error;
    if (requestSignal.aborted) throw new CollectionError("scan_timeout");
    if (error instanceof SyntaxError) throw new CollectionError("invalid_response");
    throw new CollectionError("provider_unavailable");
  }
}

const zone = z.object({ id, name: z.string().min(1), status: z.string().optional(), account: z.object({ id }), plan: cfZonePlan.optional() });
const cfPage = z.object({ success: z.literal(true), result: z.array(zone), result_info: z.object({ page: z.number().int().positive(), total_pages: z.number().int().nonnegative(), count: z.number().int().nonnegative().optional() }) });
const redis = z.object({ database_id: id, database_name: z.string().min(1), region: z.string().optional(), state: z.string().optional(), type: z.string().max(32).optional() });
const orgDetail = z.object({ plan: z.string().max(64).optional() });
const supa = z.object({ id, name: z.string().min(1), organization_id: id, region: z.string().optional(), status: z.string().optional() });
const neonProject = z.object({ id, name: z.string().min(1), org_id: z.string().optional(), region_id: z.string().optional() });
const neonPage = z.object({ projects: z.array(neonProject), pagination: z.object({ cursor: z.string().optional() }).optional(), unavailable: z.array(z.unknown()).optional(), unavailable_project_ids: z.array(z.string()).optional() });

function fact(value: ResourceFact): ResourceFact {
  const parsed = resourceFactSchema.safeParse(value);
  if (!parsed.success) throw new CollectionError("invalid_response");
  return parsed.data;
}
function append(resources: ResourceFact[], seen: Set<string>, value: ResourceFact): void {
  if (seen.has(value.nativeId)) throw new CollectionError("invalid_response");
  if (resources.length >= maxResources) throw new CollectionError("scan_limit");
  seen.add(value.nativeId);
  resources.push(fact(value));
}
function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new CollectionError("invalid_response");
  return result.data;
}

/** Plan lookups are best effort: any failure means "not detected", but a timeout still fails the scan. */
async function detect(signal: AbortSignal, lookup: () => Promise<DetectedPlan>): Promise<DetectedPlan> {
  try { return await lookup(); }
  catch (error) { if (signal.aborted) throw new CollectionError("scan_timeout"); if (error instanceof CollectionError) return undefined; throw error; }
}

const cfBase = "https://api.cloudflare.com/client/v4";
const dash = (accountId: string, path: string) => `https://dash.cloudflare.com/${encodeURIComponent(accountId)}/${path}`;

async function cfPages<T>(path: string, token: string, signal: AbortSignal, schema: z.ZodType<{ result: T[]; result_info?: z.infer<typeof cfInfo> }>): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = new URL(`${cfBase}${path}`);
    url.searchParams.set("per_page", "50"); url.searchParams.set("page", String(page));
    const result = parsed(schema, await getJson(url.toString(), `Bearer ${token}`, signal));
    items.push(...result.result);
    const total = result.result_info?.total_pages;
    if (total === undefined || total === 0 || page >= total) return items;
    if (total > maxPages) throw new CollectionError("scan_limit");
  }
  throw new CollectionError("scan_limit");
}

/** Serverless and storage products beyond zones. A product the token may not read is reported as not covered, not as empty. */
const cloudflareProducts: { key: string; list: (accountId: string, token: string, signal: AbortSignal) => Promise<ResourceFact[]> }[] = [
  { key: "worker", async list(accountId, token, signal) {
    const result = parsed(cfWorkers, await getJson(`${cfBase}/accounts/${encodeURIComponent(accountId)}/workers/scripts`, `Bearer ${token}`, signal));
    return result.result.map(item => ({ nativeId: `worker:${item.id}`, name: item.id, category: "serverless" as const, region: null, state: "online" as const, providerState: "deployed", product: "worker", sourceUrl: dash(accountId, `workers/services/view/${encodeURIComponent(item.id)}`) }));
  } },
  { key: "kv", async list(accountId, token, signal) {
    const items = await cfPages(`/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces`, token, signal, cfKv);
    return items.map(item => ({ nativeId: `kv:${item.id}`, name: item.title, category: "storage" as const, region: null, state: "online" as const, providerState: "present", product: "kv", sourceUrl: dash(accountId, "workers/kv/namespaces") }));
  } },
  { key: "d1", async list(accountId, token, signal) {
    const items = await cfPages(`/accounts/${encodeURIComponent(accountId)}/d1/database`, token, signal, cfD1);
    return items.map(item => ({ nativeId: `d1:${item.uuid}`, name: item.name, category: "database" as const, region: null, state: "online" as const, providerState: "present", product: "d1", sourceUrl: dash(accountId, `workers/d1/databases/${encodeURIComponent(item.uuid)}`) }));
  } },
  { key: "r2", async list(accountId, token, signal) {
    const buckets: { name: string; location?: string }[] = [];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    for (let page = 1; page <= maxPages; page++) {
      const url = new URL(`${cfBase}/accounts/${encodeURIComponent(accountId)}/r2/buckets`);
      url.searchParams.set("per_page", "50"); if (cursor) url.searchParams.set("cursor", cursor);
      const result = parsed(cfR2, await getJson(url.toString(), `Bearer ${token}`, signal));
      buckets.push(...result.result.buckets);
      cursor = result.result_info?.cursor;
      if (!cursor || result.result.buckets.length === 0) return buckets.map(item => ({ nativeId: `r2:${item.name}`, name: item.name, category: "storage" as const, region: item.location ?? null, state: "online" as const, providerState: "present", product: "r2", sourceUrl: dash(accountId, `r2/default/buckets/${encodeURIComponent(item.name)}`) }));
      if (seenCursors.has(cursor)) throw new CollectionError("invalid_response");
      seenCursors.add(cursor);
    }
    throw new CollectionError("scan_limit");
  } },
];

export async function collectInventory(provider: string, config: unknown, signal: AbortSignal): Promise<CompleteInventory> {
  const credentials = parseConfig(provider, config);
  const resources: ResourceFact[] = [];
  const seen = new Set<string>();
  let scope: string;
  let covered: string[] | undefined;
  let plan: DetectedPlan;
  if (provider === "oracle") {
    const oci = await collectOci(credentials, signal);
    for (const item of oci.resources) append(resources, seen, item);
    scope = oci.scope; covered = oci.covered; plan = oci.plan;
  } else if (provider === "cloudflare") {
    const { apiToken, accountId } = parsed(configs.cloudflare, credentials);
    scope = `cloudflare/account/${accountId}`;
    let expectedPages: number | undefined;
    const zoneFree: Array<boolean | undefined> = [];
    for (let page = 1; page <= maxPages; page++) {
      const url = new URL("https://api.cloudflare.com/client/v4/zones");
      url.searchParams.set("account.id", accountId); url.searchParams.set("per_page", "50"); url.searchParams.set("page", String(page));
      const result = parsed(cfPage, await getJson(url.toString(), `Bearer ${apiToken}`, signal));
      if (result.result_info.total_pages > maxPages) throw new CollectionError("scan_limit");
      if (expectedPages !== undefined && result.result_info.total_pages !== expectedPages) throw new CollectionError("invalid_response");
      if (result.result_info.page !== page || (result.result_info.total_pages !== 0 && result.result_info.total_pages < page) || (result.result_info.total_pages === 0 && result.result.length !== 0) || (result.result_info.count !== undefined && result.result_info.count !== result.result.length)) throw new CollectionError("invalid_response");
      expectedPages = result.result_info.total_pages;
      for (const item of result.result) {
        if (item.account.id !== accountId) throw new CollectionError("invalid_response");
        const free = zoneIsFree(item.plan);
        zoneFree.push(free);
        append(resources, seen, { nativeId: item.id, name: item.name, category: "network", region: null, state: item.status === "active" ? "online" : "unknown", ...(free === undefined ? {} : { billing: free ? "free_tier" as const : "billable" as const }), providerState: item.status ?? null, product: "zone", sourceUrl: `https://dash.cloudflare.com/${encodeURIComponent(accountId)}/${encodeURIComponent(item.id)}` });
      }
      if (page === result.result_info.total_pages || result.result_info.total_pages === 0) break;
      if (page === maxPages) throw new CollectionError("scan_limit");
    }
    covered = ["zone"];
    for (const product of cloudflareProducts) {
      let facts: ResourceFact[];
      try { facts = await product.list(accountId, apiToken, signal); }
      catch (error) {
        // A token without read access to a product leaves that product uncovered; every other failure stays a failed scan.
        if (error instanceof CollectionError && error.code === "unauthorized") continue;
        throw error;
      }
      for (const item of facts) append(resources, seen, item);
      covered.push(product.key);
    }
    let subscriptions: z.infer<typeof cfSubscriptions>["result"] | null = null;
    await detect(signal, async () => { subscriptions = parsed(cfSubscriptions, await getJson(`${cfBase}/accounts/${encodeURIComponent(accountId)}/subscriptions`, `Bearer ${apiToken}`, signal)).result; return undefined; });
    plan = cloudflarePlan(zoneFree, subscriptions);
  } else if (provider === "upstash") {
    const { apiEmail, apiKey } = parsed(configs.upstash, credentials);
    scope = `upstash/credential/${createHash("sha256").update(apiEmail.toLowerCase()).digest("hex")}`;
    const list = parsed(z.array(redis), await getJson("https://api.upstash.com/v2/redis/databases", `Basic ${Buffer.from(`${apiEmail}:${apiKey}`).toString("base64")}`, signal));
    plan = upstashPlan(list.map(item => item.type));
    for (const item of list) append(resources, seen, { nativeId: item.database_id, name: item.database_name, category: "database", region: item.region ?? null, state: "unknown", providerState: item.state ?? null, ...(upstashBilling(item.type) ? { billing: upstashBilling(item.type) } : {}), sourceUrl: `https://console.upstash.com/redis/${encodeURIComponent(item.database_id)}` });
  } else if (provider === "supabase") {
    const { accessToken, organizationId } = parsed(configs.supabase, credentials);
    scope = `supabase/organization/${organizationId}`;
    const list = parsed(z.array(supa), await getJson("https://api.supabase.com/v1/projects", `Bearer ${accessToken}`, signal));
    for (const item of list) {
      if (item.organization_id !== organizationId) continue;
      append(resources, seen, { nativeId: item.id, name: item.name, category: "database", region: item.region ?? null, state: item.status === "ACTIVE_HEALTHY" ? "online" : "unknown", providerState: item.status ?? null, sourceUrl: `https://supabase.com/dashboard/project/${encodeURIComponent(item.id)}` });
    }
    plan = await detect(signal, async () => orgPlan(parsed(orgDetail, await getJson(`https://api.supabase.com/v1/organizations/${encodeURIComponent(organizationId)}`, `Bearer ${accessToken}`, signal)).plan));
  } else if (provider === "neon") {
    const { apiKey, organizationId } = parsed(configs.neon, credentials);
    scope = `neon/organization/${organizationId}`;
    let cursor: string | undefined;
    const cursors = new Set<string>();
    for (let page = 1; page <= maxPages; page++) {
      const url = new URL("https://console.neon.tech/api/v2/projects");
      url.searchParams.set("org_id", organizationId); url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("cursor", cursor);
      const result = parsed(neonPage, await getJson(url.toString(), `Bearer ${apiKey}`, signal));
      if (result.unavailable?.length || result.unavailable_project_ids?.length) throw new CollectionError("invalid_response");
      for (const item of result.projects) {
        if (item.org_id && item.org_id !== organizationId) throw new CollectionError("invalid_response");
        append(resources, seen, { nativeId: item.id, name: item.name, category: "database", region: item.region_id ?? null, state: "unknown", providerState: null, sourceUrl: `https://console.neon.tech/app/projects/${encodeURIComponent(item.id)}` });
      }
      const next = result.pagination?.cursor;
      if (!next) {
        if (result.projects.length >= 100) throw new CollectionError("invalid_response");
        break;
      }
      if (result.projects.length === 0 || cursors.has(next)) throw new CollectionError("invalid_response");
      if (page === maxPages) throw new CollectionError("scan_limit");
      cursors.add(next); cursor = next;
    }
    plan = await detect(signal, async () => orgPlan(parsed(orgDetail, await getJson(`https://console.neon.tech/api/v2/organizations/${encodeURIComponent(organizationId)}`, `Bearer ${apiKey}`, signal)).plan));
  } else throw new CollectionError("unsupported");
  const result = completeInventorySchema.safeParse({ scope, resources, ...(covered ? { covered } : {}), ...(plan ? { plan } : {}) });
  if (!result.success) throw new CollectionError("invalid_response");
  return result.data;
}
