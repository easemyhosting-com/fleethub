import { z } from "zod";

/** Client-safe reading of GET /api/onboarding/cliproxy-capabilities. No Node imports, so the setup screen can use it. */
const authentication = z.enum(["authenticated", "rejected", "not_configured", "unknown"]);
const check = z.object({
  state: z.enum(["supported", "not_configured", "failed"]),
  authentication,
  reason: z.enum(["access_denied", "unavailable", "invalid_response"]).optional(),
});
const quota = z.object({ state: z.string() });

export const capabilityReportSchema = z.object({
  schemaVersion: z.literal(1),
  adapter: z.string(),
  serverVersion: z.string().nullable(),
  checkedAt: z.iso.datetime(),
  inference: check.extend({ modelCount: z.number().int().nonnegative().nullable() }),
  management: check,
  quota,
  credentials: z.array(z.object({
    id: z.string(),
    provider: z.string(),
    enablement: z.enum(["enabled", "disabled", "unknown"]),
    upstreamAvailability: z.enum(["reported_available", "reported_unavailable", "unknown"]),
  })).max(5000),
});
export type CapabilityReport = z.infer<typeof capabilityReportSchema>;

export type Tone = "ok" | "warn" | "muted";
export type CapabilityLine = { label: string; value: string; tone: Tone };

function describeCheck(value: z.infer<typeof check>, keyName: string, success: string): { value: string; tone: Tone } {
  if (value.state === "supported") return { value: success, tone: "ok" };
  if (value.state === "not_configured") return { value: `Not checked: ${keyName} is not set on the server`, tone: "muted" };
  if (value.authentication === "rejected") return { value: `The gateway rejected ${keyName}`, tone: "warn" };
  if (value.reason === "access_denied") return { value: `${keyName} lacks permission for this endpoint`, tone: "warn" };
  if (value.reason === "invalid_response") return { value: "The gateway answered in an unexpected format", tone: "warn" };
  return { value: "The gateway could not be reached", tone: "warn" };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function describeCapabilities(report: CapabilityReport): CapabilityLine[] {
  const models = report.inference.modelCount;
  const inference = describeCheck(report.inference, "CLIPROXY_API_KEY", models === null ? "Key accepted" : `Key accepted, ${plural(models, "model")} listed`);
  const management = describeCheck(report.management, "CLIPROXY_MANAGEMENT_KEY", "Key accepted");
  const lines: CapabilityLine[] = [
    { label: "Inference", ...inference },
    { label: "Management", ...management },
  ];
  if (report.management.state === "supported") {
    const creds = report.credentials;
    if (creds.length === 0) lines.push({ label: "Upstream accounts", value: "None found in the gateway", tone: "muted" });
    else {
      const count = (predicate: (item: CapabilityReport["credentials"][number]) => boolean) => creds.filter(predicate).length;
      const disabled = count(item => item.enablement === "disabled");
      const unavailable = count(item => item.upstreamAvailability === "reported_unavailable");
      const providers = new Map<string, number>();
      for (const item of creds) providers.set(item.provider, (providers.get(item.provider) ?? 0) + 1);
      const byProvider = [...providers].sort(([a], [b]) => a.localeCompare(b)).map(([name, n]) => `${name} ${n}`).join(", ");
      const problems = [disabled ? `${disabled} disabled` : null, unavailable ? `${unavailable} reported unavailable` : null].filter(Boolean).join(", ");
      lines.push({ label: "Upstream accounts", value: `${plural(creds.length, "account")} (${byProvider})${problems ? `; ${problems}` : ""}`, tone: problems ? "warn" : "ok" });
    }
  }
  lines.push({ label: "Quota", value: report.quota.state === "unsupported" ? "Not measured; this gateway adapter has no quota reader" : report.quota.state.replaceAll("_", " "), tone: "muted" });
  return lines;
}
