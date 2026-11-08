import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { queryClient } from "../src/lib/db/client";
import { bootstrapDatabase } from "../src/lib/db/bootstrap";
import { catalog } from "../src/lib/entitlements/catalog";
import { deleteAllowance, ensureCatalog, listLimits, resetCatalogSeedForTests, setAllowance, setEntitlement } from "../src/lib/entitlements/service";

describe.skipIf(process.env.AUTH_DATABASE_INTEGRATION !== "true")("limits and allowances (PostgreSQL)", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/fleethub_security") throw new Error("Requires isolated local fleethub_security database");
    vi.stubEnv("FLEETHUB_SEED_DEMO_DATA", "false");
    expect((await bootstrapDatabase()).success).toBe(true);
    await queryClient`TRUNCATE allowances, capacity_events`;
    await queryClient`DELETE FROM entitlements`;
  });
  afterAll(async () => { await queryClient`TRUNCATE allowances, capacity_events`; await queryClient`DELETE FROM entitlements`; vi.unstubAllEnvs(); await queryClient.end(); });

  it("loads the catalog once and keeps owner edits when the catalog is reloaded", async () => {
    resetCatalogSeedForTests();
    const { entitlements } = await listLimits();
    expect(entitlements).toHaveLength(catalog.length);
    await setEntitlement("oci.a1.ocpu", { limit: 3, verification: "verified", note: "checked on Oracle's page" }, "owner@example.test");
    // A newer catalog must not overwrite an edited row.
    await queryClient`UPDATE entitlements SET catalog_version = 0`;
    resetCatalogSeedForTests(); await ensureCatalog();
    const row = (await queryClient`SELECT limit_value, verification, verified_at::text AS verified_at, note, edited FROM entitlements WHERE id = 'oci.a1.ocpu'`)[0];
    expect(row).toMatchObject({ limit_value: 3, verification: "verified", note: "checked on Oracle's page", edited: true });
    expect(row.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Unedited rows follow the newer catalog.
    await queryClient`UPDATE entitlements SET limit_value = 1, catalog_version = 0 WHERE id = 'upstash.box.cpu_hours'`;
    resetCatalogSeedForTests(); await ensureCatalog();
    expect((await queryClient`SELECT limit_value FROM entitlements WHERE id = 'upstash.box.cpu_hours'`)[0].limit_value).toBe(5);
    await expect(setEntitlement("no.such.thing", { limit: 1 }, "o")).rejects.toMatchObject({ code: "not_found" });
  });

  it("stores global and per-account allowances, updates in place, validates scope, and removes them", async () => {
    await setAllowance({ entitlementId: "upstash.box.cpu_hours", scopeType: "global", limit: 4, reason: "reserve one hour" }, "owner@example.test");
    await setAllowance({ entitlementId: "upstash.box.cpu_hours", scopeType: "account", scopeId: "acc-1", limit: 2 }, "owner@example.test");
    await setAllowance({ entitlementId: "upstash.box.cpu_hours", scopeType: "global", limit: 3 }, "owner@example.test");
    const { allowances } = await listLimits();
    expect(allowances.map(row => [row.scopeType, row.scopeId, row.limit])).toEqual([["account", "acc-1", 2], ["global", "", 3]]);
    await expect(setAllowance({ entitlementId: "upstash.box.cpu_hours", scopeType: "account", limit: 1 }, "o")).rejects.toMatchObject({ code: "invalid" });
    await expect(setAllowance({ entitlementId: "x.y.z", scopeType: "global", limit: 1 }, "o")).rejects.toMatchObject({ code: "not_found" });
    await deleteAllowance(allowances[0].id, "owner@example.test");
    await expect(deleteAllowance(allowances[0].id, "o")).rejects.toMatchObject({ code: "not_found" });
    expect((await listLimits()).allowances).toHaveLength(1);
  });

  it("records who changed what, without anything secret", async () => {
    const { events } = await listLimits();
    expect(events.map(event => event.action)).toEqual(expect.arrayContaining(["entitlement_edited", "allowance_set", "allowance_removed"]));
    expect(events.every(event => event.actor === "owner@example.test")).toBe(true);
  });
});
