import { createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectOci, computeSpec, ociConfigSchema, signGet } from "../src/lib/inventory/oci";
import { collectInventory, validateInventoryConfig } from "../src/lib/inventory/collectors";
import { CollectionError } from "../src/lib/inventory/model";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const tenancy = "ocid1.tenancy.oc1..aaaatenancy";
const config = { tenancyId: tenancy, userId: "ocid1.user.oc1..aaaauser", fingerprint: "aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99", region: "ap-mumbai-1", privateKey };
const signal = new AbortController().signal;
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; vi.restoreAllMocks(); });

type Reply = { body?: unknown; status?: number; next?: string };
function mockOci(routes: Record<string, Reply | Reply[]>) {
  const calls: { host: string; target: string; headers: Headers }[] = [];
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const parsed = new URL(String(url));
    const target = `${parsed.pathname}${parsed.search}`;
    calls.push({ host: parsed.host, target, headers: new Headers(init?.headers) });
    const key = Object.keys(routes).find(route => target.startsWith(route));
    const entry = key ? routes[key] : { status: 404 };
    const reply = Array.isArray(entry) ? entry.shift() ?? { body: [] } : entry;
    return new Response(reply.status && reply.status >= 400 ? "{}" : JSON.stringify(reply.body ?? []), { status: reply.status ?? 200, headers: reply.next ? { "opc-next-page": reply.next } : {} });
  }) as typeof fetch;
  return calls;
}
const instance = (id: string, name: string, shape: string, state: string, ocpus?: number, mem?: number) => ({ id, displayName: name, lifecycleState: state, shape, availabilityDomain: "AD-1", ...(ocpus ? { shapeConfig: { ocpus, memoryInGBs: mem } } : {}) });
const base = { "/20160918/compartments": { body: [] }, "/20160918/availabilityDomains": { body: [{ name: "AD-1" }] } };

describe("OCI configuration and signing", () => {
  it("accepts a complete key and rejects malformed or encrypted ones without echoing them", () => {
    expect(() => validateInventoryConfig("oracle", config)).not.toThrow();
    for (const bad of [{ ...config, tenancyId: "ocid1.user.x" }, { ...config, region: "Mumbai" }, { ...config, fingerprint: "nope" }, { ...config, privateKey: "short" }, { ...config, privateKey: `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${"A".repeat(200)}\n-----END ENCRYPTED PRIVATE KEY-----` }, { ...config, extra: "x" }]) {
      const error = (() => { try { validateInventoryConfig("oracle", bad); } catch (cause) { return cause as CollectionError; } })();
      expect(error).toBeInstanceOf(CollectionError);
      expect(JSON.stringify(error?.fields)).not.toContain("BEGIN");
    }
    expect(ociConfigSchema.safeParse(config).success).toBe(true);
  });

  it("produces an rsa-sha256 signature that verifies against the public key over (request-target), host and date", () => {
    const date = "Wed, 28 Oct 2026 12:00:00 GMT";
    const header = signGet(config, "iaas.ap-mumbai-1.oraclecloud.com", "/20160918/instances?compartmentId=x", date);
    expect(header).toContain(`keyId="${tenancy}/${config.userId}/${config.fingerprint}"`);
    expect(header).toContain('headers="(request-target) host date"');
    const signature = /signature="([^"]+)"/.exec(header)![1];
    const verifier = createVerify("RSA-SHA256").update(`(request-target): get /20160918/instances?compartmentId=x\nhost: iaas.ap-mumbai-1.oraclecloud.com\ndate: ${date}`);
    expect(verifier.verify(createPublicKey(publicKey), signature, "base64")).toBe(true);
  });
});

describe("OCI inventory", () => {
  it("lists instances with shape, size and architecture, maps state, skips terminated, and covers every product", async () => {
    const calls = mockOci({
      ...base,
      "/20160918/instances": { body: [instance("i1", "Atlas", "VM.Standard.A1.Flex", "RUNNING", 2, 12), instance("i2", "micro", "VM.Standard.E2.1.Micro", "STOPPED", 1, 1), instance("i3", "gone", "VM.Standard.E2.1.Micro", "TERMINATED"), instance("i4", "starting", "VM.Standard.A1.Flex", "STARTING", 2, 12)] },
      "/20160918/volumes": { body: [{ id: "v1", displayName: "data", lifecycleState: "AVAILABLE", sizeInGBs: 50 }] },
      "/20160918/bootVolumes": { body: [{ id: "b1", displayName: "boot", lifecycleState: "AVAILABLE", sizeInGBs: 47 }] },
      "/n/": [{ body: "ns1" }, { body: [{ name: "bucket-a" }] }],
      "/20160918/autonomousDatabases": { body: [{ id: "d1", displayName: "adb", lifecycleState: "STOPPED", cpuCoreCount: 1, dataStorageSizeInTBs: 0.02, isFreeTier: true }] },
    });
    const result = await collectOci(config, signal);
    expect(result.scope).toBe(`oracle/tenancy/${tenancy}/ap-mumbai-1`);
    expect(result.covered).toEqual(["instance", "volume", "bootvolume", "bucket", "database"]);
    const byName = Object.fromEntries(result.resources.map(item => [item.name, item]));
    expect(Object.keys(byName)).toEqual(expect.arrayContaining(["Atlas", "micro", "starting", "data", "boot", "bucket-a", "adb"]));
    expect(byName.gone).toBeUndefined();
    expect(byName.Atlas).toMatchObject({ nativeId: "instance:i1", category: "compute", state: "online", providerState: "RUNNING", product: "instance", region: "ap-mumbai-1" });
    expect(byName.Atlas.attributes).toMatchObject({ shape: "VM.Standard.A1.Flex", arch: "arm64", capacityKind: "shared_pool", ocpus: 2, memoryGb: 12 });
    expect(byName.micro).toMatchObject({ state: "offline" });
    expect(byName.micro.attributes).toMatchObject({ arch: "x86_64", capacityKind: "fixed" });
    expect(byName.starting.state).toBe("busy");
    expect(byName["bucket-a"].nativeId).toBe("bucket:ns1/bucket-a");
    expect(byName.adb).toMatchObject({ category: "database", state: "offline" });
    // Every request is a signed GET to the tenancy's regional Oracle endpoints only.
    expect(calls.every(call => /^(iaas|identity|objectstorage|database)\.ap-mumbai-1\.oraclecloud\.com$/.test(call.host))).toBe(true);
    expect(calls.every(call => call.headers.get("authorization")?.startsWith('Signature version="1"'))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("PRIVATE KEY");
    // Through the shared entry point as well, with the same facts validated by the common schema.
    mockOci({ ...base, "/20160918/instances": { body: [instance("i1", "Atlas", "VM.Standard.A1.Flex", "RUNNING", 2, 12)] } });
    expect((await collectInventory("oracle", config, signal)).resources[0].attributes).toMatchObject({ arch: "arm64" });
  });

  it("walks child compartments and follows pagination tokens", async () => {
    const calls = mockOci({
      "/20160918/compartments": { body: [{ id: "child1", lifecycleState: "ACTIVE" }, { id: "gone", lifecycleState: "DELETED" }] },
      "/20160918/availabilityDomains": { body: [] },
      "/20160918/instances": [{ body: [instance("i1", "one", "VM.Standard.A1.Flex", "RUNNING", 2, 12)], next: "p2" }, { body: [instance("i2", "two", "VM.Standard.A1.Flex", "RUNNING", 2, 12)] }, { body: [instance("i3", "three", "VM.Standard.E2.1.Micro", "RUNNING", 1, 1)] }],
    });
    const result = await collectOci(config, signal);
    expect(result.resources.filter(item => item.product === "instance").map(item => item.name)).toEqual(["one", "two", "three"]);
    const instanceCalls = calls.filter(call => call.target.startsWith("/20160918/instances"));
    expect(instanceCalls[1].target).toContain("page=p2");
    expect(instanceCalls[2].target).toContain("compartmentId=child1");
    expect(calls.some(call => call.target.includes("gone"))).toBe(false);
  });

  it("requires compute access, leaves unreadable products uncovered, and fails on other errors", async () => {
    mockOci({ ...base, "/20160918/instances": { status: 404 } });
    await expect(collectOci(config, signal)).rejects.toMatchObject({ code: "unauthorized" });
    mockOci({ ...base, "/20160918/instances": { body: [instance("i1", "one", "VM.Standard.A1.Flex", "RUNNING", 2, 12)] }, "/20160918/volumes": { status: 403 }, "/20160918/bootVolumes": { body: [] }, "/n/": { status: 404 }, "/20160918/autonomousDatabases": { body: [] } });
    const partial = await collectOci(config, signal);
    expect(partial.covered).toEqual(["instance", "bootvolume", "database"]);
    mockOci({ ...base, "/20160918/instances": { body: [] }, "/20160918/volumes": { status: 500 } });
    await expect(collectOci(config, signal)).rejects.toMatchObject({ code: "provider_unavailable" });
    mockOci({ ...base, "/20160918/instances": { status: 429 } });
    await expect(collectOci(config, signal)).rejects.toMatchObject({ code: "rate_limited" });
    mockOci({ ...base, "/20160918/instances": { body: { not: "a list" } } });
    await expect(collectOci(config, signal)).rejects.toMatchObject({ code: "invalid_response" });
    mockOci({ ...base, "/20160918/instances": [{ body: [], next: "same" }, { body: [], next: "same" }] });
    await expect(collectOci(config, signal)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("derives compute limits from the shape", () => {
    expect(computeSpec("VM.Standard.A1.Flex", 2, 12)).toEqual({ shape: "VM.Standard.A1.Flex", arch: "arm64", capacityKind: "shared_pool", ocpus: 2, memoryGb: 12 });
    expect(computeSpec("VM.Standard.E2.1.Micro")).toEqual({ shape: "VM.Standard.E2.1.Micro", arch: "x86_64", capacityKind: "fixed" });
    expect(computeSpec("VM.Standard.E4.Flex", 1, 4).capacityKind).toBe("elastic");
  });

  it("fails closed when signing is impossible", async () => {
    mockOci(base);
    await expect(collectOci({ ...config, privateKey: `-----BEGIN PRIVATE KEY-----\n${"A".repeat(200)}\n-----END PRIVATE KEY-----` }, signal)).rejects.toMatchObject({ code: "invalid_config" });
  });
});
