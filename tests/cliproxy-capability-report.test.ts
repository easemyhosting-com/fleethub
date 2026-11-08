import { describe, expect, it } from "vitest";
import { capabilityReportSchema, describeCapabilities, type CapabilityReport } from "../src/lib/cliproxy/capability-report";

const base = (extra: Partial<CapabilityReport> = {}): CapabilityReport => ({
  schemaVersion: 1, adapter: "cliproxy-v8", serverVersion: null, checkedAt: "2026-11-09T00:00:00.000Z",
  inference: { state: "supported", authentication: "authenticated", modelCount: 12 },
  management: { state: "supported", authentication: "authenticated" },
  quota: { state: "unsupported" },
  credentials: [],
  ...extra,
});
const credential = (provider: string, enablement: "enabled" | "disabled" | "unknown" = "enabled", upstreamAvailability: "reported_available" | "reported_unavailable" | "unknown" = "reported_available") => ({ id: `${provider}-${enablement}-${upstreamAvailability}`, provider, enablement, upstreamAvailability });
const byLabel = (report: CapabilityReport) => Object.fromEntries(describeCapabilities(report).map(line => [line.label, line]));

describe("CLIProxy capability report for the setup screen", () => {
  it("accepts the route's report shape, extra fields included, and rejects other shapes", () => {
    const wire = { ...base({ credentials: [credential("codex")] }), inference: { ...base().inference, upstreamAvailability: "unknown" }, quota: { state: "unsupported", reason: "adapter_has_no_quota_reader" } };
    (wire.credentials[0] as Record<string, unknown>).authentication = "unknown";
    expect(capabilityReportSchema.safeParse(wire).success).toBe(true);
    expect(capabilityReportSchema.safeParse({ ...wire, schemaVersion: 2 }).success).toBe(false);
    expect(capabilityReportSchema.safeParse({ error: "Save gateway connection settings first" }).success).toBe(false);
  });
  it("summarises working keys, model count, accounts by provider and the unmeasured quota", () => {
    const lines = byLabel(base({ credentials: [credential("codex"), credential("claude"), credential("codex")] }));
    expect(lines.Inference).toEqual({ label: "Inference", value: "Key accepted, 12 models listed", tone: "ok" });
    expect(lines.Management.tone).toBe("ok");
    expect(lines["Upstream accounts"]).toEqual({ label: "Upstream accounts", value: "3 accounts (claude 1, codex 2)", tone: "ok" });
    expect(lines.Quota).toMatchObject({ value: "Not measured; this gateway adapter has no quota reader", tone: "muted" });
    expect(byLabel(base({ inference: { state: "supported", authentication: "authenticated", modelCount: 1 } })).Inference.value).toBe("Key accepted, 1 model listed");
    expect(byLabel(base({ inference: { state: "supported", authentication: "authenticated", modelCount: null } })).Inference.value).toBe("Key accepted");
  });
  it("flags disabled and reported-unavailable accounts, and an empty gateway", () => {
    const lines = byLabel(base({ credentials: [credential("codex", "disabled"), credential("gemini", "enabled", "reported_unavailable"), credential("unknown", "unknown", "unknown")] }));
    expect(lines["Upstream accounts"]).toEqual({ label: "Upstream accounts", value: "3 accounts (codex 1, gemini 1, unknown 1); 1 disabled, 1 reported unavailable", tone: "warn" });
    expect(byLabel(base())["Upstream accounts"]).toMatchObject({ value: "None found in the gateway", tone: "muted" });
  });
  it("explains each failure without claiming accounts it could not read", () => {
    const failed = (authentication: "rejected" | "unknown", reason: "access_denied" | "unavailable" | "invalid_response") => ({ state: "failed" as const, authentication, reason });
    const lines = byLabel(base({ inference: { state: "not_configured", authentication: "not_configured", modelCount: null }, management: failed("rejected", "access_denied") }));
    expect(lines.Inference).toMatchObject({ value: "Not checked: CLIPROXY_API_KEY is not set on the server", tone: "muted" });
    expect(lines.Management).toMatchObject({ value: "The gateway rejected CLIPROXY_MANAGEMENT_KEY", tone: "warn" });
    expect(lines["Upstream accounts"]).toBeUndefined();
    expect(byLabel(base({ management: failed("unknown", "access_denied") })).Management.value).toBe("CLIPROXY_MANAGEMENT_KEY lacks permission for this endpoint");
    expect(byLabel(base({ management: failed("unknown", "invalid_response") })).Management.value).toBe("The gateway answered in an unexpected format");
    expect(byLabel(base({ management: failed("unknown", "unavailable") })).Management.value).toBe("The gateway could not be reached");
    expect(byLabel(base({ quota: { state: "not_loaded" } })).Quota.value).toBe("not loaded");
  });
});
