import { describe, it, expect } from "vitest";
import { MASTER_CATALOG } from "../src/lib/catalog/providers";
import {
  ResetWindowSchema,
  QuotaMeterDefinitionSchema,
  ProviderPolicySchema,
  ProviderCatalogItemSchema,
} from "../src/lib/catalog/schema";

describe("Catalog Schema & Provider Validation", () => {
  it("validates all providers in MASTER_CATALOG conform strictly to Zod schema", () => {
    expect(MASTER_CATALOG.length).toBeGreaterThan(0);

    for (const provider of MASTER_CATALOG) {
      const parsed = ProviderCatalogItemSchema.safeParse(provider);
      expect(parsed.success, `Provider ${provider.id} failed schema validation: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it("contains core required providers (oracle, cloudflare, turso, upstash, github)", () => {
    const ids = MASTER_CATALOG.map((p) => p.id);
    expect(ids).toContain("oracle");
    expect(ids).toContain("cloudflare");
    expect(ids).toContain("turso");
    expect(ids).toContain("upstash");
    expect(ids).toContain("github");
  });

  it("verifies Oracle Cloud quota definitions and guardrails", () => {
    const oci = MASTER_CATALOG.find((p) => p.id === "oracle");
    expect(oci).toBeDefined();
    expect(oci?.tier).toBe("always_free");
    expect(oci?.policy.multiAccount).toBe("prohibited");

    const a1Quota = oci?.quotas.find((q) => q.id === "oci.a1.ocpu_hours");
    expect(a1Quota).toBeDefined();
    expect(a1Quota?.limit).toBe(1500);
    expect(a1Quota?.unit).toBe("ocpu_hours");

    const blockStorage = oci?.quotas.find((q) => q.id === "oci.storage.block");
    expect(blockStorage?.limit).toBe(200);
  });

  it("verifies Cloudflare zero-egress R2 and Workers quotas", () => {
    const cf = MASTER_CATALOG.find((p) => p.id === "cloudflare");
    expect(cf).toBeDefined();

    const workers = cf?.quotas.find((q) => q.id === "cf.workers.requests");
    expect(workers?.limit).toBe(100000);
    expect(workers?.window.kind).toBe("daily");

    const r2 = cf?.quotas.find((q) => q.id === "cf.r2.storage");
    expect(r2?.limit).toBe(10);
    expect(r2?.unit).toBe("gb_month");
  });

  it("validates ResetWindowSchema edge cases", () => {
    // calendar_month
    expect(ResetWindowSchema.safeParse({ kind: "calendar_month", tz: "UTC" }).success).toBe(true);

    // rolling
    expect(ResetWindowSchema.safeParse({ kind: "rolling", days: 14 }).success).toBe(true);
    expect(ResetWindowSchema.safeParse({ kind: "rolling" }).success).toBe(false);

    // billing_cycle
    expect(ResetWindowSchema.safeParse({ kind: "billing_cycle", anchor: "account" }).success).toBe(true);
    expect(ResetWindowSchema.safeParse({ kind: "billing_cycle" }).success).toBe(false);

    // session_duration
    expect(ResetWindowSchema.safeParse({ kind: "session_duration", maxHours: 12 }).success).toBe(true);
    expect(ResetWindowSchema.safeParse({ kind: "session_duration" }).success).toBe(false);

    // none
    expect(ResetWindowSchema.safeParse({ kind: "none" }).success).toBe(true);
  });
});
