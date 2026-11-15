import type { DependencyEvidence as Evidence } from "@/lib/projects/dependency-evidence";

export function DependencyEvidence({ evidence }: { evidence: Evidence }) {
  return <div className="mt-2 space-y-2 border-t border-zinc-800 pt-2 text-xs text-zinc-400 [overflow-wrap:anywhere]">
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
      <dt>Owner</dt><dd>{evidence.ownerLabel ?? "Unknown"}</dd>
      <dt>Account</dt><dd>{evidence.accountLabel ?? evidence.accountId ?? "Unknown"}</dd>
      <dt>Relationship</dt><dd>{evidence.kind}; confidence {evidence.confidence === null ? "unknown" : `${Math.round(evidence.confidence * 100)}%`}</dd>
      <dt>Link evidence</dt><dd>{evidence.freshness} · {evidence.lastSeen ?? "No timestamp"}</dd>
      <dt>Usage observation</dt><dd>{evidence.observationFreshness} · {evidence.observedAt ?? "None recorded"}</dd>
    </dl>
    <p>No measured headroom or permission to share is established by this relationship.</p>
  </div>;
}
