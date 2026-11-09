import type { GraphNode, IdentityGraphResponse, IdentityWithAccounts } from "./types";

export interface FleetMatches {
  accounts: ReadonlySet<string>;
  resources: ReadonlySet<string>;
}

export function selectIdentityAccounts(identities: IdentityWithAccounts[], matches: FleetMatches): IdentityWithAccounts[] {
  return identities.flatMap(identity => {
    const accounts = identity.accounts.filter(account => matches.accounts.has(account.id)).map(account => ({
      ...account,
      resources: account.resources.filter(resource => matches.resources.has(resource.id)),
    }));
    return accounts.length ? [{ ...identity, accounts }] : [];
  });
}

/** Keep matched inventory and each node's ownership path in the graph. */
export function selectIdentityGraph(graph: IdentityGraphResponse, matches: FleetMatches): IdentityGraphResponse {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const retained = new Set<string>();
  function keep(node: GraphNode | undefined) {
    while (node && !retained.has(node.id)) {
      retained.add(node.id);
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }
  }

  for (const node of graph.nodes) {
    if (node.type === "account" && typeof node.data.accountId === "string" && matches.accounts.has(node.data.accountId)) keep(node);
    if (node.type === "resource" && typeof node.data.resourceId === "string" && matches.resources.has(node.data.resourceId)) keep(node);
  }
  for (const node of graph.nodes) {
    if ((node.type === "quota" || node.type === "secret_ref") && node.parentId && retained.has(node.parentId)) keep(node);
  }

  const nodes = graph.nodes.filter(node => retained.has(node.id));
  const accounts = nodes.filter(node => node.type === "account");
  return {
    nodes,
    edges: graph.edges.filter(edge => retained.has(edge.source) && retained.has(edge.target)),
    summary: {
      totalIdentities: nodes.filter(node => node.type === "identity").length,
      totalProviders: new Set(accounts.map(node => node.provider)).size,
      totalAccounts: accounts.length,
      protectedAccounts: accounts.filter(node => node.isProtected).length,
      totalResources: nodes.filter(node => node.type === "resource").length,
      totalQuotaMeters: nodes.filter(node => node.type === "quota").length,
    },
  };
}
