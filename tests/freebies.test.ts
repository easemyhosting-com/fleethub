import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FREEBIES, FreebieEntrySchema, filterFreebies, freebieFacets, freebieFilterToParams, parseFreebieFilter, type FreebieEntry,
} from "../src/lib/catalog/freebies";
import { renderFreebiesMarkdown } from "../src/lib/catalog/freebies/markdown";

const sample = (patch: Partial<FreebieEntry>): FreebieEntry => ({
  id: "test.thing", provider: "test", providerName: "Test Cloud", service: "Thing", category: "compute",
  limit: { type: "count", value: 1, unit: "VMs", note: "One VM." }, scope: "per_account", homeRegionOnly: null,
  caveats: [], sourceUrl: "https://example.com/limits", verifiedAt: "2026-11-20", verification: "verified",
  suggestedUses: [], fitTags: [], ...patch,
});

describe("freebies catalog data", () => {
  it("every entry matches the schema and ids are unique", () => {
    for (const entry of FREEBIES) {
      const parsed = FreebieEntrySchema.safeParse(entry);
      expect(parsed.success, `${entry.id}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
    expect(new Set(FREEBIES.map(entry => entry.id)).size).toBe(FREEBIES.length);
  });

  it("shared-quota references point at real entries", () => {
    const ids = new Set(FREEBIES.map(entry => entry.id));
    for (const entry of FREEBIES) for (const caveat of entry.caveats) for (const id of caveat.sharesWith ?? []) expect(ids.has(id), `${entry.id} -> ${id}`).toBe(true);
  });

  it("records the OCI limits from the research", () => {
    const get = (id: string) => FREEBIES.find(entry => entry.id === id);
    expect(get("oci.compute-a1")?.limit).toMatchObject({ value: 1500, unit: "OCPU-hours" });
    expect(get("oci.compute-a1")?.homeRegionOnly).toBe(true);
    expect(get("oci.block-volume")?.limit.value).toBe(200);
    expect(get("oci.object-storage")?.limit.value).toBe(20);
    expect(get("oci.flexible-load-balancer")?.homeRegionOnly).toBe(true);
    expect(FREEBIES.some(entry => entry.homeRegionOnly === false)).toBe(false);
    expect(get("oci.queue")?.verification).toBe("unverified");
  });

  it("docs/freebies/oci.md matches the data (run npm run docs:freebies)", () => {
    const doc = readFileSync(path.resolve(import.meta.dirname, "../docs/freebies/oci.md"), "utf8");
    const oci = FREEBIES.filter(item => item.provider === "oci");
    expect(doc).toBe(renderFreebiesMarkdown("Oracle Cloud (OCI)", oci));
    for (const entry of oci) expect(doc, entry.id).toContain(`\`${entry.id}\``);
  });

  it("escapes table pipes and skips entries with nothing to add", () => {
    const md = renderFreebiesMarkdown("Test", [sample({ service: "A | B", homeRegionOnly: true }), sample({ id: "test.other", homeRegionOnly: false, caveats: [{ kind: "other", text: "Note." }] })]);
    expect(md).toContain("A \\| B");
    expect(md).toContain("| yes |");
    expect(md).toContain("| no |");
    expect(md).not.toContain("### A | B");
    expect(md).toContain("- **other:** Note.");
    const tagOnly = renderFreebiesMarkdown("Test", [sample({ fitTags: ["uptime-probe"] }), sample({ id: "test.empty" })]);
    expect(tagOnly).toContain("- **Fit tags:** uptime-probe");
    expect(tagOnly).not.toContain("(`test.empty`)");
  });

  it("rejects non-https sources and unknown fields", () => {
    expect(FreebieEntrySchema.safeParse(sample({ sourceUrl: "http://example.com" })).success).toBe(false);
    expect(FreebieEntrySchema.safeParse({ ...sample({}), accountId: "x" }).success).toBe(false);
  });
});

describe("filterFreebies", () => {
  const entries = [
    sample({ id: "a.vm", provider: "a", category: "compute", homeRegionOnly: true, fitTags: ["small-vm-host", "uptime-probe"], suggestedUses: ["Run a probe"] }),
    sample({ id: "a.bucket", provider: "a", category: "storage", limit: { type: "capacity", value: 20, unit: "GB", note: "20 GB shared." }, homeRegionOnly: false, verification: "marketing", fitTags: ["offsite-backups"], caveats: [{ kind: "egress", text: "Egress billed past 10 TB" }] }),
    sample({ id: "b.mail", provider: "b", providerName: "Other", category: "email", limit: { type: "monthly", value: 3000, unit: "emails", note: "3,000 per month." }, verification: "unverified" }),
  ];
  const ids = (filter: Parameters<typeof filterFreebies>[1]) => filterFreebies(entries, filter).map(entry => entry.id);

  it("returns everything with an empty filter", () => expect(ids({})).toEqual(["a.vm", "a.bucket", "b.mail"]));
  it("filters by provider, category, limit type and verification", () => {
    expect(ids({ provider: "b" })).toEqual(["b.mail"]);
    expect(ids({ category: "storage" })).toEqual(["a.bucket"]);
    expect(ids({ limitType: "monthly" })).toEqual(["b.mail"]);
    expect(ids({ verification: "marketing" })).toEqual(["a.bucket"]);
  });
  it("treats home-region true, false and unset distinctly; null never matches a boolean", () => {
    expect(ids({ homeRegionOnly: true })).toEqual(["a.vm"]);
    expect(ids({ homeRegionOnly: false })).toEqual(["a.bucket"]);
  });
  it("requires every selected fit tag", () => {
    expect(ids({ fitTags: ["uptime-probe"] })).toEqual(["a.vm"]);
    expect(ids({ fitTags: ["uptime-probe", "offsite-backups"] })).toEqual([]);
  });
  it("searches case-insensitively across notes, caveats, uses and tags, requiring all terms", () => {
    expect(ids({ search: "EGRESS" })).toEqual(["a.bucket"]);
    expect(ids({ search: "probe" })).toEqual(["a.vm"]);
    expect(ids({ search: "offsite" })).toEqual(["a.bucket"]);
    expect(ids({ search: "  20  shared " })).toEqual(["a.bucket"]);
    expect(ids({ search: "20 emails" })).toEqual([]);
    expect(ids({ search: "other" })).toEqual(["b.mail"]);
  });
  it("combines filters with AND", () => expect(ids({ provider: "a", search: "gb" })).toEqual(["a.bucket"]));
});

describe("facets and URL round trip", () => {
  it("only offers options present in the data", () => {
    const facets = freebieFacets(FREEBIES);
    expect(facets.providers).toEqual([{ id: "oci", name: "Oracle Cloud (OCI)" }]);
    expect(facets.categories).toContain("compute");
    expect(facets.verifications).toEqual(["verified", "marketing", "unverified"]);
    expect(filterFreebies(FREEBIES, { fitTags: [facets.fitTags[0]] }).length).toBeGreaterThan(0);
    expect(freebieFacets([]).categories).toEqual([]);
  });
  it("sorts providers by display name", () => {
    expect(freebieFacets([sample({ provider: "z", providerName: "Zed" }), sample({ provider: "y", providerName: "Alpha" })]).providers.map(item => item.id)).toEqual(["y", "z"]);
  });
  it("parses and serializes filters, dropping unknown values", () => {
    const filter = { search: "backup", provider: "oci", category: "storage", limitType: "capacity", homeRegionOnly: false, verification: "verified", fitTags: ["offsite-backups", "image-mirror"] } as const;
    expect(parseFreebieFilter(freebieFilterToParams(filter))).toEqual(filter);
    expect(parseFreebieFilter(new URLSearchParams("homeRegionOnly=true")).homeRegionOnly).toBe(true);
    expect(parseFreebieFilter(new URLSearchParams("category=bogus&limit=x&verification=y&fit=nope&provider=Bad%20Id&homeRegionOnly=maybe"))).toEqual({
      search: undefined, provider: undefined, category: undefined, limitType: undefined, homeRegionOnly: undefined, verification: undefined, fitTags: undefined,
    });
    expect(parseFreebieFilter(new URLSearchParams(`q=${"x".repeat(300)}`)).search).toHaveLength(256);
    expect(freebieFilterToParams({}).toString()).toBe("");
  });
});
