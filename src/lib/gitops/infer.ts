import type { ParsedRepo } from "./parse";

export interface KnownResource { id: string; name: string; nativeId: string | null; provider: string; category: string }
export type LinkSource = "gitops" | "inferred";
export interface InferredLink { resourceId: string; source: LinkSource; confidence: number; purpose: string | null; evidence: string }

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const nativeName = (resource: KnownResource) => resource.nativeId?.includes(":") ? resource.nativeId.split(":").slice(1).join(":") : resource.nativeId;

/** Resolve a reference the way a person writes it: resource id, native id, `kind:name`, or exact name. Ambiguous names resolve to nothing. */
export function resolveResource(reference: string, resources: KnownResource[]): KnownResource | null {
  const exact = resources.filter(item => item.id === reference || item.nativeId === reference);
  if (exact.length === 1) return exact[0];
  const named = resources.filter(item => same(item.name, reference) || (nativeName(item) !== null && same(nativeName(item)!, reference)));
  return named.length === 1 ? named[0] : null;
}

/**
 * Evidence-first inference for one project. Strongest first:
 * 1. declared in fleethub.yaml or the fleethub.dev/uses annotation (confidence 1, source gitops);
 * 2. an Ingress, HTTPRoute or Certificate host that sits under a registered zone (0.7);
 * 3. a resource whose name contains the project slug (0.35, labelled a guess).
 * Rejected resources are skipped and confirmed ones are lifted by the caller. Every link carries the fact it came from.
 */
export function inferLinks(parsed: ParsedRepo, resources: KnownResource[], project: { slug: string }): InferredLink[] {
  const found = new Map<string, InferredLink>();
  const add = (link: InferredLink) => { const key = `${link.resourceId}:${link.source}`; const current = found.get(key); if (!current || current.confidence < link.confidence) found.set(key, link); };

  for (const declaration of parsed.declarations) for (const use of declaration.uses) {
    const resource = resolveResource(use.resource, resources);
    if (resource) add({ resourceId: resource.id, source: "gitops", confidence: 1, purpose: use.purpose ?? null, evidence: `declared in ${declaration.file}` });
  }
  for (const workload of parsed.workloads) {
    for (const reference of workload.uses) {
      const resource = resolveResource(reference, resources);
      if (resource) add({ resourceId: resource.id, source: "gitops", confidence: 1, purpose: `${workload.kind} ${workload.name}`, evidence: `annotation fleethub.dev/uses on ${workload.kind} ${workload.name} (${workload.file})` });
    }
    for (const host of workload.hosts) {
      const bare = host.replace(/^\*\./, "").toLowerCase();
      for (const zone of resources.filter(item => item.category === "network")) {
        if (bare === zone.name.toLowerCase() || bare.endsWith(`.${zone.name.toLowerCase()}`)) add({ resourceId: zone.id, source: "inferred", confidence: 0.7, purpose: `serves ${bare}`, evidence: `${workload.kind} ${workload.name} serves ${bare}, under zone ${zone.name} (${workload.file})` });
      }
    }
  }
  const slug = project.slug.toLowerCase();
  if (slug.length >= 4) for (const resource of resources) {
    if (resource.category === "network") continue;
    if (resource.name.toLowerCase().includes(slug)) add({ resourceId: resource.id, source: "inferred", confidence: 0.35, purpose: null, evidence: `guess: resource name "${resource.name}" contains the project slug "${slug}"` });
  }
  return [...found.values()].sort((a, b) => b.confidence - a.confidence);
}
