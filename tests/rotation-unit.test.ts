import { afterEach, describe, expect, it, vi } from "vitest";
import { cloudflareRotator, cloudflareTokenExpiry } from "../src/lib/rotation/cloudflare";
import { getRotator, listRotators, registerRotator, resetRotatorsForTests } from "../src/lib/rotation/registry";
import { scopeOf, secretFieldsOf } from "../src/lib/rotation/scope";
import { credentialFields } from "../src/lib/rotation/fields";
import { RotationError, type CredentialRotator } from "../src/lib/rotation/types";

const signal = new AbortController().signal;
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; vi.restoreAllMocks(); });

function mockFetch(handler: (url: string, init: RequestInit) => unknown) {
  const calls: { url: string; method: string; auth: string }[] = [];
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), method: init?.method ?? "GET", auth: headers.get("authorization") ?? "" });
    const result = handler(String(url), init ?? {});
    return result instanceof Response ? result : new Response(JSON.stringify(result), { status: 200 });
  }) as typeof fetch;
  return calls;
}

describe("cloudflare token expiry", () => {
  it("reads the date Cloudflare reports, and null when the token never expires", async () => {
    mockFetch(() => ({ success: true, result: { id: "tok-1", status: "active", expires_on: "2027-03-01T00:00:00Z" } }));
    expect((await cloudflareTokenExpiry("t", "acct1", signal))?.toISOString()).toBe("2027-03-01T00:00:00.000Z");
    mockFetch(() => ({ success: true, result: { id: "tok-1", status: "active" } }));
    expect(await cloudflareTokenExpiry("t", "acct1", signal)).toBeNull();
    mockFetch(() => ({ success: true, result: { id: "tok-1", expires_on: "not a date" } }));
    expect(await cloudflareTokenExpiry("t", "acct1", signal)).toBeNull();
  });
});

describe("rotator registry", () => {
  it("registers one rotator per provider and rejects duplicates", () => {
    resetRotatorsForTests();
    const fake: CredentialRotator = { providerId: "demo", label: "Demo", rotatorHint: "hint", rotate: async () => ({}), checkRotatorSecret: async () => {} };
    registerRotator(fake);
    expect(getRotator("demo")).toBe(fake);
    expect(listRotators()).toHaveLength(1);
    expect(() => registerRotator(fake)).toThrow("already registered");
    expect(getRotator("missing")).toBeUndefined();
    resetRotatorsForTests();
  });
});

describe("credential scope", () => {
  it("ignores secret fields and key order but not account identifiers", () => {
    expect(secretFieldsOf("cloudflare")).toEqual(["apiToken"]);
    expect(secretFieldsOf("unknown")).toEqual([]);
    expect(scopeOf("cloudflare", { apiToken: "a", accountId: "x" })).toBe(scopeOf("cloudflare", { accountId: "x", apiToken: "b" }));
    expect(scopeOf("cloudflare", { apiToken: "a", accountId: "x" })).not.toBe(scopeOf("cloudflare", { apiToken: "a", accountId: "y" }));
  });
  it("offers replacement fields for every provider that collects inventory", () => {
    for (const provider of ["cloudflare", "upstash", "supabase", "neon"]) {
      const fields = credentialFields[provider];
      expect(fields.some(field => field.secret)).toBe(true);
      for (const field of fields.filter(item => item.secret)) expect(secretFieldsOf(provider)).toContain(field.key);
    }
  });
});

describe("Cloudflare rotator", () => {
  const newSecret = "n".repeat(48);
  const current = { apiToken: "old-scan-token", accountId: "acct1" };

  it("looks up the scan token's id and rolls it with the rotation credential", async () => {
    const calls = mockFetch(url => url.endsWith("/user/tokens/verify") ? { success: true, result: { id: "tok-1", status: "active" } } : { success: true, result: newSecret });
    const next = await cloudflareRotator.rotate({ current, rotatorSecret: "rotator", signal });
    expect(next).toEqual({ apiToken: newSecret, accountId: "acct1" });
    expect(calls).toEqual([
      { url: "https://api.cloudflare.com/client/v4/user/tokens/verify", method: "GET", auth: "Bearer old-scan-token" },
      { url: "https://api.cloudflare.com/client/v4/user/tokens/tok-1/value", method: "PUT", auth: "Bearer rotator" },
    ]);
  });

  it("falls back to account-owned token endpoints", async () => {
    const calls = mockFetch(url => url.includes("/user/") ? new Response("{}", { status: 401 }) : url.endsWith("/verify") ? { success: true, result: { id: "tok-2" } } : { success: true, result: newSecret });
    await cloudflareRotator.rotate({ current, rotatorSecret: "rotator", signal });
    expect(calls.at(-1)?.url).toBe("https://api.cloudflare.com/client/v4/accounts/acct1/tokens/tok-2/value");
  });

  it("fails closed on rejected, malformed or incomplete responses", async () => {
    mockFetch(url => url.endsWith("/verify") ? { success: true, result: { id: "tok-1" } } : new Response("{}", { status: 403 }));
    await expect(cloudflareRotator.rotate({ current, rotatorSecret: "r", signal })).rejects.toMatchObject({ code: "provider_rejected" });
    mockFetch(url => url.endsWith("/verify") ? { success: true, result: { id: "tok-1" } } : { success: true, result: "short" });
    await expect(cloudflareRotator.rotate({ current, rotatorSecret: "r", signal })).rejects.toMatchObject({ code: "provider_rejected" });
    mockFetch(() => new Response("{}", { status: 401 }));
    await expect(cloudflareRotator.rotate({ current, rotatorSecret: "r", signal })).rejects.toBeInstanceOf(RotationError);
    await expect(cloudflareRotator.rotate({ current: { accountId: "a" }, rotatorSecret: "r", signal })).rejects.toMatchObject({ code: "invalid_config" });
  });

  it("accepts only an active rotation credential", async () => {
    mockFetch(() => ({ success: true, result: { id: "r1", status: "active" } }));
    await expect(cloudflareRotator.checkRotatorSecret("r", signal, current)).resolves.toBeUndefined();
    mockFetch(() => ({ success: true, result: { id: "r1", status: "disabled" } }));
    await expect(cloudflareRotator.checkRotatorSecret("r", signal, current)).rejects.toMatchObject({ code: "provider_rejected" });
    await expect(cloudflareRotator.checkRotatorSecret("r", signal, {})).rejects.toBeInstanceOf(RotationError);
  });
});
