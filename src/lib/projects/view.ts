import type { ProjectFootprint } from "@/lib/projects/footprint";

export type ProjectLink = ProjectFootprint["links"][number];

export type ProjectKindFilter = "all" | "app" | "service" | "platform";

export function projectKindLabel(kind: string): string {
  if (kind === "app") return "App";
  if (kind === "service") return "Service";
  if (kind === "platform") return "Platform";
  return kind;
}

export function projectKindConfirmation(name: string, kind: string): string {
  return kind === "auto" ? `Discovery will decide the kind for ${name}.` : `${name} is now a ${projectKindLabel(kind)} project.`;
}

export function filterProjectsByKind<T extends { kind: string }>(projects: T[], filter: ProjectKindFilter, includePlatform = false): T[] {
  if (filter !== "all") return projects.filter(project => project.kind === filter);
  return projects.filter(project => includePlatform || project.kind !== "platform");
}

export function confidenceLabel(confidence: number | null, source: string): string {
  if (source === "declared" || confidence === 1) return "declared";
  if (confidence === null || confidence < 0.5) return "guess";
  return "likely";
}

export function groupProjectLinks(links: ProjectLink[]) {
  return {
    suggested: links.filter(link => link.status === "suggested" && link.source === "inferred"),
    other: links.filter(link => !(link.status === "suggested" && link.source === "inferred")),
  };
}

export function projectAttentionReasons(project: Pick<ProjectFootprint, "unallocatedUsage" | "billableLinks" | "links" | "usageState" | "usage">): string[] {
  const reasons: string[] = [];
  if (project.unallocatedUsage > 0) reasons.push(`${project.unallocatedUsage} usage report${project.unallocatedUsage === 1 ? "" : "s"} could not be matched to a FleetHub resource`);
  if (project.billableLinks > 0) reasons.push(`${project.billableLinks} billable linked resource${project.billableLinks === 1 ? "" : "s"} create cost exposure`);
  if (project.links.some(link => link.source === "declared" && !project.usage.some(row => row.matched && row.resourceRef === link.resourceId))) reasons.push("A declared resource has no matched usage report");
  if (project.usageState === "stale") reasons.push("Usage reports are stale");
  return reasons;
}
