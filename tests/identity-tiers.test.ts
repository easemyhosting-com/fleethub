import { describe, expect, it } from "vitest";
import { byEmail, byProvider, rollup, usageBand, usedMeters, visibleResources } from "../src/lib/identity/tiers";
import type { IdentityWithAccounts, ProviderAccountDetail } from "../src/lib/identity/types";

const account = (over: Partial<ProviderAccountDetail>): ProviderAccountDetail => ({ id: "a", identityId: "p", provider: "cloudflare", label: "L", ownerEmail: "a@x.test", loginEmail: "a@x.test", role: "member", isProtected: false, health: "ok", resources: [], quotaMeters: [], enabled: true, createdAt: "", ...over });
const resource = (id: string, billable: boolean) => ({ id, name: id, category: "compute" as const, provider: "cloudflare", accountId: "a", state: "online" as const, isProtected: false, tags: [], attributes: {}, billing: billable ? "billable" as const : "free_tier" as const, lastSeenAt: "" });
const person: IdentityWithAccounts = { id: "p", displayName: "P", createdAt: "", updatedAt: "", contacts: [
  { id: "c1", identityId: "p", kind: "email", value: "a@x.test", isPrimary: true, isVerified: true }, { id: "c2", identityId: "p", kind: "email", value: "b@x.test", isPrimary: false, isVerified: true }, { id: "c3", identityId: "p", kind: "phone", value: "+1", isPrimary: false, isVerified: false }],
  accounts: [account({ id: "a1", contactId: "c2" }), account({ id: "a2", provider: "oracle" }), account({ id: "a3", ownerEmail: "z@x.test" })] };

describe("identity tiers", () => {
  it("bands usage at 50, 80, 90 and 100 percent", () => {
    expect([0, 49, 50, 80, 90, 100].map(v => usageBand(v, 100))).toEqual(["unused", "low", "half", "high", "critical", "full"]);
    expect(usageBand(undefined, 100)).toBe("unknown"); expect(usageBand(5, 0)).toBe("unknown");
  });
  it("groups accounts under their email, falling back to the owner email", () => {
    const [tier] = byEmail([person]);
    expect(tier.emails.map(e => [e.email, e.accounts.map(a => a.id)])).toEqual([["a@x.test", ["a2"]], ["b@x.test", ["a1"]], ["z@x.test", ["a3"]]]);
  });
  it("groups the same accounts by provider", () => {
    expect(byProvider([person]).map(t => [t.provider, t.accounts.length])).toEqual([["cloudflare", 2], ["oracle", 1]]);
  });
  it("hides paid-only resources on a free account and marks them on a paid one", () => {
    const resources = [resource("free", false), resource("paid", true)];
    expect(visibleResources(account({ plan: "free", resources })).map(r => r.resource.id)).toEqual(["free"]);
    expect(visibleResources(account({ plan: "paid", resources })).map(r => r.paidOnly)).toEqual([false, true]);
  });
  it("computes meter percentages", () => {
    const meters = usedMeters(account({ quotaMeters: [{ id: "m", accountId: "a", key: "k", name: "n", category: "c", unit: "GB", limitValue: 10, currentValue: 9, warnPct: 80, critPct: 90, source: "api" }, { id: "n", accountId: "a", key: "k", name: "n", category: "c", unit: "GB", limitValue: 10, warnPct: 80, critPct: 90, source: "none" }] }));
    expect(meters.map(m => [m.band, m.pct])).toEqual([["critical", 90], ["unknown", null]]);
  });
  it("rolls a group of accounts up to providers, plans, fullest meter and attention", () => {
    const meter = (id: string, current: number) => ({ id, accountId: "a", key: id, name: id, category: "c", unit: "GB", limitValue: 10, currentValue: current, warnPct: 80, critPct: 90, source: "api" as const });
    const r = rollup([account({ id: "1", plan: "free", quotaMeters: [meter("m1", 3)] }), account({ id: "2", provider: "oracle", plan: "paid", health: "error", quotaMeters: [meter("m2", 9)] }), account({ id: "3", health: "degraded", archived: true })]);
    expect(r).toMatchObject({ accounts: 3, free: 1, paid: 1, unknownPlan: 1, worst: "critical", worstPct: 90, needsAttention: 1 });
    expect(r.byProvider).toEqual([{ provider: "cloudflare", count: 2 }, { provider: "oracle", count: 1 }]);
    expect(rollup([])).toMatchObject({ accounts: 0, worst: "unknown", worstPct: null });
  });
});
