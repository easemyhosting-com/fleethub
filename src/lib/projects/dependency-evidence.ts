import { z } from "zod";
import { evaluateFreshness } from "@/lib/capacity/arithmetic";

export const dependencyEvidenceSchema = z.strictObject({
  ownerLabel: z.string().nullable(), accountId: z.string().nullable(), accountLabel: z.string().nullable(),
  kind: z.enum(["declared", "observed", "inferred", "unknown"]), confidence: z.number().min(0).max(1).nullable(),
  lastSeen: z.string().nullable(), freshness: z.enum(["fresh", "stale", "expired", "unmeasured"]),
  observedAt: z.string().nullable(), observationFreshness: z.enum(["fresh", "stale", "expired", "unmeasured"]),
  sharingPermission: z.literal("unverified"), headroom: z.literal("unverified"),
});
export type DependencyEvidence = z.infer<typeof dependencyEvidenceSchema>;

export function dependencyEvidence(input: {
  source: string; confidence: number | null; lastSeen: Date | string | null;
  observedAt: Date | string | null; ownerLabel: string | null; accountId: string | null; accountLabel: string | null;
}, now = new Date()): DependencyEvidence {
  const stamp = (value: Date | string | null) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  };
  const lastSeen = stamp(input.lastSeen), observedAt = stamp(input.observedAt);
  const kind = input.source === "declared" ? "declared" : input.source === "observed" ? "observed"
    : ["gitops", "inferred"].includes(input.source) ? "inferred" : "unknown";
  return {
    ownerLabel: input.ownerLabel, accountId: input.accountId, accountLabel: input.accountLabel,
    kind, confidence: input.confidence !== null && Number.isFinite(input.confidence) && input.confidence >= 0 && input.confidence <= 1 ? input.confidence : null,
    lastSeen, freshness: evaluateFreshness(lastSeen, now), observedAt, observationFreshness: evaluateFreshness(observedAt, now),
    sharingPermission: "unverified", headroom: "unverified",
  };
}
