import type { Declared, Discovery, ProposedProject } from "@/lib/gitops/discover";

/** `/containers/json` entries plus optional `/containers/{id}/json` inspect results keyed by container id. Only metadata: no env, no logs, no exec. */
export interface DockerSnapshot { containers: any[]; inspect?: Record<string, any> }

const slugOf = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 39).replace(/-+$/g, "");

/** Hostnames declared on reverse-proxy labels: Traefik `Host(`a.com`)` rules and Caddy docker-proxy `caddy` labels. Deterministic, no guessing. */
export function domainsFromLabels(labels: Record<string, string> | undefined): string[] {
  const out = new Set<string>();
  for (const [key, value] of Object.entries(labels ?? {})) {
    if (/^traefik\.http\.routers\..+\.rule$/.test(key) && typeof value === "string") for (const m of value.matchAll(/Host(?:SNI)?\(([^)]*)\)/g)) for (const h of m[1].matchAll(/`([^`]+)`/g)) out.add(h[1].toLowerCase());
    if (/^caddy(_\d+)?$/.test(key) && typeof value === "string") for (const h of value.split(/\s+/)) if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(h)) out.add(h.toLowerCase());
  }
  return [...out].slice(0, 10);
}

/** One project per Compose project (label `com.docker.compose.project`), otherwise one per standalone container. Host = the Docker host the caller names. */
export function normalizeDocker(host: string, snapshot: DockerSnapshot): Discovery {
  const groups = new Map<string, { name: string; via: string; items: any[] }>();
  for (const c of snapshot.containers ?? []) {
    const project = c?.Labels?.["com.docker.compose.project"];
    const name = String(project ?? (c?.Names?.[0] ?? c?.Id ?? "container")).replace(/^\//, "");
    const key = slugOf(name);
    if (key.length < 2) continue;
    const group = groups.get(key) ?? { name, via: project ? `Compose project ${project}` : `container ${name}`, items: [] };
    group.items.push(c); groups.set(key, group);
  }
  const projects: ProposedProject[] = [];
  for (const [slug, g] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const declared: Declared = { replicas: null, cpuRequestMilli: 0, cpuLimitMilli: 0, memRequestMi: 0, memLimitMi: 0, pvcGi: 0, containers: 0 };
    for (const c of g.items) {
      if (c?.State && c.State !== "running") continue;
      declared.containers += 1;
      const host = snapshot.inspect?.[c.Id]?.HostConfig;
      if (host?.NanoCpus) declared.cpuLimitMilli += Math.round(Number(host.NanoCpus) / 1_000_000);
      if (host?.Memory) declared.memLimitMi += Math.round(Number(host.Memory) / 1048576);
      if (host?.MemoryReservation) declared.memRequestMi += Math.round(Number(host.MemoryReservation) / 1048576);
    }
    const domains = [...new Set(g.items.flatMap(c => domainsFromLabels(c?.Labels)))].slice(0, 10);
    const running = g.items.filter(c => !c?.State || c.State === "running").length;
    projects.push({
      slug, name: g.name, kind: domains.length ? "app" : "service", dir: g.name, domains,
      images: [...new Set(g.items.map(c => String(c?.Image ?? "").split(":")[0].split("@")[0]).filter(Boolean))].slice(0, 20), source: "docker", fileCount: g.items.length,
      reason: domains.length ? `proxy labels route ${domains[0]}` : `${running} running container${running === 1 ? "" : "s"}, no routed hostname`,
      placements: [{ host, runtime: "docker", evidence: `${g.via}: ${running} running of ${g.items.length}`, declared, scope: g.name }],
    });
  }
  return { hosts: [{ name: host, runtime: "docker" }], projects, findings: [], skipped: [] };
}
