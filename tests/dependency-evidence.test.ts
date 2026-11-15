import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { createRequire } from "node:module";
const server: unknown = createRequire(import.meta.url)("react-dom/server");
import { dependencyEvidence, dependencyEvidenceSchema } from "../src/lib/projects/dependency-evidence";
import { DependencyEvidence } from "../src/components/DependencyEvidence";
const now = new Date("2026-11-16T12:00:00Z");
const base = { source: "inferred", confidence: 1, lastSeen: now.toISOString(), observedAt: null, ownerLabel: null, accountId: null, accountLabel: null };

describe("Dependency evidence", () => {
  it("does not convert confidence into declared source or infer usage and sharing permission", () => {
    expect(dependencyEvidence(base, now)).toMatchObject({ kind: "inferred", confidence: 1, observationFreshness: "unmeasured", headroom: "unverified", sharingPermission: "unverified" });
    expect(dependencyEvidence({ ...base, source: "gitops" }, now).kind).toBe("inferred");
  });
  it("keeps relationship freshness separate from observed usage", () => {
    const evidence = dependencyEvidence({ ...base, observedAt: "2026-11-14T12:00:00Z" }, now);
    expect(evidence.freshness).toBe("fresh");
    expect(evidence.observationFreshness).toBe("expired");
  });
  it("preserves malformed and future dates and invalid confidence as unknown evidence", () => {
    expect(dependencyEvidence({ ...base, lastSeen: "invalid", confidence: 2 }, now)).toMatchObject({ lastSeen: null, freshness: "unmeasured", confidence: null });
    expect(dependencyEvidence({ ...base, observedAt: "2099-01-01" }, now).observationFreshness).toBe("unmeasured");
    expect(dependencyEvidenceSchema.safeParse({ ...dependencyEvidence(base), sharingPermission: "allowed" }).success).toBe(false);
  });
  it("renders provenance, unknowns and the permission boundary with escaped owner labels", () => {
    const evidence = dependencyEvidence({ ...base, ownerLabel: "<script>sample</script>", accountLabel: "Fixture account" }, now);
    if (!server || typeof server !== "object" || !("renderToStaticMarkup" in server) || typeof server.renderToStaticMarkup !== "function") throw new Error("React server renderer unavailable");
    const markup: unknown = server.renderToStaticMarkup(createElement(DependencyEvidence, { evidence }));
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("Fixture account");
    expect(markup).toContain("None recorded");
    expect(markup).toContain("No measured headroom or permission to share");
  });
});
