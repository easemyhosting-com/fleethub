import { describe, expect, it } from "vitest";
import { layoutGroups, squarify } from "../src/lib/fleetmap/layout";
import { buildTiles, capacityText, capacityWeight, groupTiles, noFilters, summarize, tileState } from "../src/lib/fleetmap/model";
import { publicResourceSpecs } from "../src/lib/providers/config-security";
import { profileInputSchema, defaultProfile } from "../src/lib/fleet/vocabulary";
import type { FleetAccount, FleetResource } from "../src/lib/inventory/model";

const rect = { x: 0, y: 0, w: 800, h: 500 };
const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;

describe("treemap layout", () => {
  const items = [30, 20, 15, 10, 8, 6, 5, 3, 2, 1].map((weight, index) => ({ id: `t${index}`, weight }));
  it("fills the rectangle exactly, in proportion, without overlap or leaving it", () => {
    const placed = squarify(items, rect);
    expect(placed).toHaveLength(items.length);
    expect(placed.reduce((sum, tile) => sum + tile.w * tile.h, 0)).toBeCloseTo(rect.w * rect.h, 3);
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    for (const tile of placed) {
      expect(tile.w * tile.h).toBeCloseTo((items.find(item => item.id === tile.id)!.weight / total) * rect.w * rect.h, 3);
      expect(tile.x).toBeGreaterThanOrEqual(-0.001); expect(tile.y).toBeGreaterThanOrEqual(-0.001);
      expect(tile.x + tile.w).toBeLessThanOrEqual(rect.w + 0.001); expect(tile.y + tile.h).toBeLessThanOrEqual(rect.h + 0.001);
    }
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(overlap(placed[i], placed[j])).toBe(false);
  });
  it("keeps tiles reasonably square and is deterministic", () => {
    const placed = squarify(items, rect);
    for (const tile of placed) expect(Math.max(tile.w / tile.h, tile.h / tile.w)).toBeLessThan(6);
    expect(squarify([...items].reverse(), rect)).toEqual(placed);
  });
  it("handles empty, zero and degenerate input", () => {
    expect(squarify([], rect)).toEqual([]);
    expect(squarify([{ id: "a", weight: 0 }], rect)).toEqual([]);
    expect(squarify([{ id: "a", weight: 1 }], { x: 0, y: 0, w: 0, h: 10 })).toEqual([]);
    expect(squarify([{ id: "a", weight: 5 }], rect)).toEqual([{ id: "a", ...rect }]);
  });
  it("lays out groups by total weight and keeps their tiles inside the group body below the header", () => {
    const groups = [{ key: "a", label: "A", items: items.slice(0, 4) }, { key: "b", label: "B", items: items.slice(4) }];
    const placed = layoutGroups(groups, rect, 22, 3);
    expect(placed.map(group => group.key).sort()).toEqual(["a", "b"]);
    for (const group of placed) for (const tile of group.tiles) {
      expect(tile.y).toBeGreaterThanOrEqual(group.rect.y + 22 - 0.001);
      expect(tile.x).toBeGreaterThanOrEqual(group.rect.x - 0.001);
      expect(tile.x + tile.w).toBeLessThanOrEqual(group.rect.x + group.rect.w + 0.001);
      expect(tile.y + tile.h).toBeLessThanOrEqual(group.rect.y + group.rect.h + 0.001);
    }
    expect(placed.reduce((sum, group) => sum + group.tiles.length, 0)).toBe(items.length);
  });
});

const account = (id: string, label: string): FleetAccount => ({ id, kind: "oracle", label, ownerEmail: "o@x.test", loginEmail: null, health: "ok", enabled: true, credentialExpiresAt: null, isProtected: true, collection: { state: "ready", lastAttemptAt: null, lastSuccessAt: null, freshUntil: null, nextAttemptAt: null, errorCode: null, message: "", resourceCount: 0 } });
const resource = (id: string, over: Partial<FleetResource> = {}): FleetResource => ({
  id, accountId: "a1", accountEmail: "o@x.test", provider: "oracle", name: id, category: "compute", state: "online", isProtected: true, tags: [], attributes: {}, specs: {}, region: "ap-mumbai-1",
  profile: { ...defaultProfile, set: false }, lastSeenAt: null, nativeId: id, sourceUrl: null, inventorySource: "provider", presence: "present", freshness: "current", ...over,
});

describe("fleet map model", () => {
  const accounts = [account("a1", "Mumbai A"), account("a2", "Mumbai B")];
  const resources = [
    resource("vm1", { specs: { ocpus: 2, memoryGb: 12, arch: "arm64" } }),
    resource("vm2", { accountId: "a2", state: "offline", specs: { ocpus: 1, memoryGb: 1, arch: "x86_64" }, profile: { ...defaultProfile, set: true, role: "ci_runner" } }),
    resource("disk", { category: "storage", specs: { sizeGb: 47 }, state: "unknown", freshness: "stale" }),
    resource("gone", { presence: "missing" }),
    resource("busy", { state: "busy", provider: "cloudflare", accountId: null }),
  ];
  it("maps provider state to display state, never guessing", () => {
    expect(resources.map(tileState)).toEqual(["running", "stopped", "unknown", "missing", "changing"]);
  });
  it("weights by capacity with a floor, or equally", () => {
    expect(capacityWeight(resources[0])).toBe(14);
    expect(capacityWeight(resources[1])).toBe(4.5);
    expect(capacityWeight(resources[2])).toBeGreaterThan(1);
    expect(capacityWeight(resources[3])).toBe(1);
    expect(buildTiles(resources, accounts, "provider", "equal", noFilters).every(tile => tile.weight === 1)).toBe(true);
    expect(capacityText(resources[0])).toBe("2 OCPU · 12 GB · arm64");
  });
  it("groups and filters", () => {
    expect(groupTiles(buildTiles(resources, accounts, "provider", "capacity", noFilters)).map(group => [group.label, group.items.length]).sort()).toEqual([["cloudflare", 1], ["oracle", 4]]);
    expect(groupTiles(buildTiles(resources, accounts, "account", "capacity", noFilters)).map(group => group.label).sort()).toEqual(["Mumbai A", "Mumbai B", "No account"]);
    expect(groupTiles(buildTiles(resources, accounts, "role", "capacity", noFilters)).map(group => group.label).sort()).toEqual(["CI runner", "General"]);
    expect(buildTiles(resources, accounts, "provider", "capacity", { ...noFilters, category: "storage" }).map(tile => tile.id)).toEqual(["disk"]);
    expect(buildTiles(resources, accounts, "provider", "capacity", { ...noFilters, state: "stopped" }).map(tile => tile.id)).toEqual(["vm2"]);
    expect(buildTiles(resources, accounts, "provider", "capacity", { ...noFilters, accountId: "a2" }).map(tile => tile.id)).toEqual(["vm2"]);
    expect(buildTiles(resources, accounts, "provider", "capacity", { ...noFilters, role: "ci_runner" }).map(tile => tile.id)).toEqual(["vm2"]);
    expect(buildTiles(resources, accounts, "provider", "capacity", { ...noFilters, attention: true }).map(tile => tile.id).sort()).toEqual(["disk", "gone"]);
    expect(summarize(buildTiles(resources, accounts, "provider", "capacity", noFilters))).toEqual({ running: 1, changing: 1, stopped: 1, unknown: 1, missing: 1 });
    expect(buildTiles(resources, accounts, "region", "equal", noFilters).find(tile => tile.id === "busy")?.groupLabel).toBe("ap-mumbai-1");
  });
});

describe("public specs and profile vocabulary", () => {
  it("exposes only descriptive spec fields", () => {
    expect(publicResourceSpecs({ shape: "VM.Standard.A1.Flex", ocpus: 2, product: "instance", privateKey: "secret", token: "t", sizeGb: null, nested: { a: 1 }, memoryGb: Number.NaN })).toEqual({ shape: "VM.Standard.A1.Flex", ocpus: 2, product: "instance", sizeGb: null });
    expect(publicResourceSpecs(null)).toEqual({}); expect(publicResourceSpecs([1])).toEqual({});
  });
  it("accepts only the fixed vocabulary and bounded labels", () => {
    expect(profileInputSchema.safeParse({ role: "ci_runner", lifecycle: "on_demand", labels: { site: "main" } }).success).toBe(true);
    for (const bad of [{ role: "wizard" }, { lifecycle: "sometimes" }, { autoStop: "yolo" }, { labels: { "Bad Key": "x" } }, { labels: { k: "" } }, { extra: 1 }, { labels: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"])) }]) expect(profileInputSchema.safeParse(bad).success).toBe(false);
  });
});
