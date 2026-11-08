import { describe, expect, it } from "vitest";
import { confidenceLabel, groupProjectLinks, projectAttentionReasons, projectKindConfirmation, projectKindLabel } from "@/lib/projects/view";

const base = { unallocatedUsage: 0, billableLinks: 0, links: [], usage: [], usageState: "reporting" as const };

describe("projectAttentionReasons", () => {
  it("reports all applicable attention reasons", () => {
    const reasons = projectAttentionReasons({
      ...base, unallocatedUsage: 2, billableLinks: 1, usageState: "stale",
      links: [{ resourceId: "r1", source: "declared" } as never],
    });
    expect(reasons).toHaveLength(4);
    expect(reasons.join(" ")).toContain("could not be matched");
    expect(reasons.join(" ")).toContain("cost exposure");
    expect(reasons.join(" ")).toContain("declared resource");
    expect(reasons.join(" ")).toContain("stale");
  });

  it("returns no reasons when the footprint needs no attention", () => {
    expect(projectAttentionReasons(base)).toEqual([]);
  });
});

describe("project link presentation helpers", () => {
  it("labels confidence at the specified thresholds", () => {
    expect(confidenceLabel(0.49, "inferred")).toBe("guess");
    expect(confidenceLabel(0.5, "inferred")).toBe("likely");
    expect(confidenceLabel(0.99, "gitops")).toBe("likely");
    expect(confidenceLabel(1, "inferred")).toBe("declared");
    expect(confidenceLabel(null, "declared")).toBe("declared");
  });

  it("groups only unconfirmed inferred suggestions as actionable suggestions", () => {
    const suggested = { resourceId: "a", source: "inferred", status: "suggested" } as never;
    const confirmed = { resourceId: "b", source: "inferred", status: "in_use" } as never;
    const gitops = { resourceId: "c", source: "gitops", status: "suggested" } as never;
    expect(groupProjectLinks([suggested, confirmed, gitops])).toEqual({ suggested: [suggested], other: [confirmed, gitops] });
  });
});

describe("project kind presentation helpers", () => {
  it("labels known project kinds", () => {
    expect(projectKindLabel("app")).toBe("App");
    expect(projectKindLabel("service")).toBe("Service");
    expect(projectKindLabel("platform")).toBe("Platform");
  });

  it("builds kind change confirmations", () => {
    expect(projectKindConfirmation("Storefront", "platform")).toBe("Storefront is now a Platform project.");
    expect(projectKindConfirmation("Storefront", "auto")).toBe("Discovery will decide the kind for Storefront.");
  });
});
