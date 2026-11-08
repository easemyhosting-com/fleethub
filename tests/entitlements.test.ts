import { describe, expect, it } from "vitest";
import { catalog } from "../src/lib/entitlements/catalog";
import { effectiveLimit } from "../src/lib/entitlements/service";

describe("entitlement catalog", () => {
  it("has unique, well-formed ids and honest verification metadata", () => {
    const ids = catalog.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of catalog) {
      expect(entry.id).toMatch(/^[a-z0-9_]+(\.[a-z0-9_]+){2}$/);
      expect(entry.id.startsWith(`${entry.provider}.`)).toBe(true);
      expect(entry.limit).toBeGreaterThanOrEqual(0);
      // Only figures read from a provider page may claim verification, and they must name the source and date.
      if (entry.verification === "verified") { expect(entry.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(entry.sourceUrl).toMatch(/^https:/); }
      else expect(entry.verifiedAt).toBeUndefined();
    }
  });
  it("records the current OCI Ampere A1 allowance as owner-reported 2 OCPU and 12 GB", () => {
    const get = (id: string) => catalog.find(entry => entry.id === id);
    expect(get("oci.a1.ocpu")).toMatchObject({ limit: 2, verification: "reported" });
    expect(get("oci.a1.memory_gb")).toMatchObject({ limit: 12, verification: "reported" });
  });
});

describe("effective limit", () => {
  it("uses the smaller of the entitlement and the allowance, and never trusts unverified figures", () => {
    expect(effectiveLimit({ limit: 10, verification: "verified" })).toEqual({ limit: 10, usable: true });
    expect(effectiveLimit({ limit: 10, verification: "verified" }, 4)).toEqual({ limit: 4, usable: true });
    expect(effectiveLimit({ limit: 10, verification: "reported" }, 40)).toEqual({ limit: 10, usable: true });
    expect(effectiveLimit({ limit: 10, verification: "unverified" }, null)).toEqual({ limit: 10, usable: false });
  });
});
