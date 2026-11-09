import { queryClient } from "@/lib/db/client";
import type { FleetMatches } from "@/lib/identity/fleet-selection";

/** Declared and GitOps links count when active. Inferred links also require a current owner confirmation. */
export async function readProjectFleetMatches(slug: string): Promise<FleetMatches & { links: ReadonlySet<string> }> {
  const rows = await queryClient<{ link_id: string; resource_id: string; account_id: string | null }[]>`
    SELECT l.id AS link_id, l.resource_id, r.account_id
    FROM projects p
    JOIN project_resource_links l ON l.project_id = p.id
    JOIN resources r ON r.id = l.resource_id
    LEFT JOIN provider_accounts a ON a.id = r.account_id
    LEFT JOIN project_link_decisions d ON d.project_id = p.id AND d.resource_id = r.id
    WHERE p.slug = ${slug} AND p.archived_at IS NULL
      AND r.retired_at IS NULL AND r.state <> 'missing' AND a.archived_at IS NULL
      AND l.status IN ('allocated', 'in_use')
      AND (l.source IN ('declared', 'gitops') OR (l.source = 'inferred' AND d.decision = 'confirm'))
  `;
  return {
    links: new Set(rows.map(row => row.link_id)),
    accounts: new Set(rows.flatMap(row => row.account_id === null ? [] : [row.account_id])),
    resources: new Set(rows.map(row => row.resource_id)),
  };
}
