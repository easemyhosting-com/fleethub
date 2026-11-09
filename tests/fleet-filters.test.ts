import { describe, expect, it } from "vitest";
import { accountMatches, filterIdentities, filterSnapshot, filterToParams, hasFilter, parseFilter } from "../src/lib/fleet/filters";
import { filterFleetProblems } from "../src/lib/fleet/problem-search";
import { selectIdentityGraph } from "../src/lib/identity/fleet-selection";
import type { GraphNode } from "../src/lib/identity/types";
import { fleetSnapshotSchema } from "../src/lib/inventory/model";

const accounts = [
  { id: "a1", identityId: "p1", ownerEmail: "Owner@example.com", kind: "cloudflare", plan: "free" },
  { id: "a2", identityId: "p1", ownerEmail: "alex@example.com", kind: "cloudflare", plan: "paid" },
  { id: "a3", identityId: "p2", ownerEmail: "k@x.co", kind: "oracle" },
];
const resources = [{ accountId: "a1" }, { accountId: "a2" }, { accountId: "a3" }, { accountId: null }];

describe("fleet filters", () => {
  it("parses, ignores 'all' and bad plans, and round-trips", () => {
    expect(parseFilter(new URLSearchParams("person=p1&email=a@b.co&provider=all&plan=free"))).toEqual({ person: "p1", email: "a@b.co", plan: "free" });
    expect(parseFilter(new URLSearchParams("plan=gold&person=%20"))).toEqual({});
    const params = filterToParams({ person: "p1", plan: "paid" }, new URLSearchParams("email=old@x.co&keep=1"));
    expect(params.toString()).toBe("keep=1&person=p1&plan=paid");
    expect(hasFilter({})).toBe(false);
    expect(hasFilter({ plan: "free" })).toBe(true);
  });
  it("matches accounts on every given field, case-insensitively for email", () => {
    expect(accountMatches(accounts[0], { email: "owner@EXAMPLE.com", provider: "Cloudflare", plan: "free", person: "p1" })).toBe(true);
    expect(accountMatches(accounts[0], { person: "p2" })).toBe(false);
    expect(accountMatches(accounts[0], { email: "other@x.co" })).toBe(false);
    expect(accountMatches(accounts[0], { provider: "oracle" })).toBe(false);
    expect(accountMatches(accounts[0], { plan: "paid" })).toBe(false);
    expect(accountMatches(accounts[2], { plan: "unknown" })).toBe(true);
    expect(accountMatches({ ownerEmail: "a@b.co", provider: "neon" }, { provider: "neon" })).toBe(true);
    expect(accountMatches({ ownerEmail: "a@b.co" }, { provider: "neon" })).toBe(false);
  });
  it("narrows a snapshot to matching accounts and their resources", () => {
    const snapshot = { accounts, resources, extra: 1 };
    expect(filterSnapshot(snapshot, {})).toBe(snapshot);
    const paid = filterSnapshot(snapshot, { plan: "paid" });
    expect(paid.accounts.map(account => account.id)).toEqual(["a2"]);
    expect(paid.resources).toEqual([{ accountId: "a2" }]);
    expect(paid.extra).toBe(1);
  });
  it("filters people: a person filter keeps them, an account filter drops people with no match", () => {
    const people = [{ id: "p1", accounts: [accounts[0], accounts[1]] }, { id: "p2", accounts: [accounts[2]] }, { id: "p3", accounts: [] }];
    expect(filterIdentities(people, {})).toBe(people);
    expect(filterIdentities(people, { person: "p3" }).map(person => person.id)).toEqual(["p3"]);
    const free = filterIdentities(people, { plan: "free" });
    expect(free.map(person => person.id)).toEqual(["p1"]);
    expect(free[0].accounts).toHaveLength(1);
    expect(filterIdentities(people, { email: "alex@example.com", provider: "cloudflare" })[0].accounts.map(account => account.id)).toEqual(["a2"]);
  });
});

it("matches collection failures and resource problems while retaining ownership", () => {
  const collection = {
    state: "ready", message: "", errorCode: null, resourceCount: 1,
    lastAttemptAt: null, lastSuccessAt: null, freshUntil: null, nextAttemptAt: null,
  } as const;
  const account = {
    kind: "cloudflare", ownerEmail: "owner@example.test", loginEmail: null, health: "ok",
    enabled: true, credentialExpiresAt: null, isProtected: false, collection,
  };
  const resource = {
    accountEmail: account.ownerEmail, category: "network", provider: account.kind, state: "online",
    isProtected: false, tags: [], attributes: {}, lastSeenAt: null, nativeId: null, region: null,
    sourceUrl: null, inventorySource: "provider", presence: "present", freshness: "current",
  };
  const snapshot = fleetSnapshotSchema.parse({
    status: "online", timestamp: "2026-11-01T00:00:00Z", gateways: [],
    worker: { status: "online", lastSeenAt: null },
    accounts: [
      { ...account, id: "acc-ok", label: "Healthy" },
      { ...account, id: "acc-error", label: "Degraded", collection: { ...collection, errorCode: "rate_limited" } },
    ],
    resources: [
      { ...resource, id: "healthy", name: "Healthy zone", accountId: "acc-ok" },
      { ...resource, id: "missing", name: "Missing zone", accountId: "acc-ok", presence: "missing" },
      { ...resource, id: "degraded", name: "Degraded zone", accountId: "acc-error" },
    ],
  });
  expect(filterFleetProblems(snapshot, "", false)).toBe(snapshot);
  const rateLimited = filterFleetProblems(snapshot, " RATE LIMITED ", false);
  expect(rateLimited.accounts.map(item => item.id)).toEqual(["acc-error"]);
  expect(rateLimited.resources.map(item => item.id)).toEqual(["degraded"]);
  const attention = filterFleetProblems(snapshot, "", true);
  expect(attention.accounts.map(item => item.id)).toEqual(["acc-ok", "acc-error"]);
  expect(attention.resources.map(item => item.id)).toEqual(["missing", "degraded"]);
  expect(filterFleetProblems(snapshot, "healthy zone", true).resources).toEqual([]);
});

it("retains the full graph ownership path for a matching resource", () => {
  const nodes: GraphNode[] = [
    { id: "owner", type: "identity", label: "Owner", data: {} },
    { id: "email", type: "email", label: "Email", parentId: "owner", data: {} },
    { id: "provider", type: "provider", label: "Cloudflare", parentId: "email", data: {} },
    { id: "account", type: "account", label: "Account", parentId: "provider", provider: "cloudflare", data: { accountId: "acc-a" } },
    { id: "wanted", type: "resource", label: "Wanted", parentId: "account", data: { resourceId: "wanted" } },
    { id: "other", type: "resource", label: "Other", parentId: "account", data: { resourceId: "other" } },
  ];
  const result = selectIdentityGraph({
    nodes,
    edges: nodes.flatMap(node => node.parentId ? [{ id: node.id, source: node.parentId, target: node.id }] : []),
    summary: { totalIdentities: 1, totalProviders: 1, totalAccounts: 1, protectedAccounts: 0, totalResources: 2, totalQuotaMeters: 0 },
  }, { accounts: new Set(["acc-a"]), resources: new Set(["wanted"]) });
  expect(result.nodes.map(node => node.id)).toEqual(["owner", "email", "provider", "account", "wanted"]);
  expect(result.edges.map(edge => edge.target)).toEqual(["email", "provider", "account", "wanted"]);
  expect(result.summary.totalResources).toBe(1);
});
