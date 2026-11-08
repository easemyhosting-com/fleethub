import { describe, expect, it } from "vitest";
import { accountMatches, filterIdentities, filterSnapshot, filterToParams, hasFilter, parseFilter } from "../src/lib/fleet/filters";

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
