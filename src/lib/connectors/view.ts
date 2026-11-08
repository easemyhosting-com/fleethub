import type { ProposedProject } from "@/lib/gitops/discover";

export function connectorKindLabel(kind: string): string {
  if (kind === "kubernetes") return "Kubernetes";
  if (kind === "docker") return "Docker";
  if (kind === "prometheus") return "Prometheus";
  return kind;
}

export function defaultConnectorSelection(projects: ProposedProject[]): string[] {
  return projects.filter(project => project.kind !== "platform").map(project => project.slug);
}

export function connectorLastScanLabel(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Never scanned";
}

export function intervalLabel(minutes: number): string {
  if (minutes === 0) return "Manual only";
  if (minutes < 60) return `Every ${minutes} minutes`;
  if (minutes === 60) return "Every hour";
  if (minutes < 1440) return `Every ${minutes / 60} hours`;
  return minutes === 1440 ? "Once a day" : `Every ${minutes / 1440} days`;
}

/** What an automatic scan does for each kind; it never registers or un-archives anything on its own. */
export function scheduleNote(kind: string): string {
  return kind === "prometheus"
    ? "Records measured usage for hosts and matching projects."
    : "Refreshes placements for registered projects. New ones are only listed for review.";
}
