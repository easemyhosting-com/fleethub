export const filterPlans = ["free", "paid", "unknown"] as const;
export interface FleetFilter { person?: string; email?: string; provider?: string; plan?: string }
export interface FilterableAccount { identityId?: string | null; ownerEmail: string; kind?: string; provider?: string; plan?: string }

const keys = ["person", "email", "provider", "plan"] as const;

/** Reads the four filters from query parameters; empty and "all" values mean no filter. */
export function parseFilter(params: URLSearchParams): FleetFilter {
  const filter: FleetFilter = {};
  for (const key of keys) {
    const value = params.get(key)?.trim();
    if (value && value.toLowerCase() !== "all" && value.length <= 256) filter[key] = value;
  }
  if (filter.plan && !(filterPlans as readonly string[]).includes(filter.plan)) delete filter.plan;
  return filter;
}

export function filterToParams(filter: FleetFilter, into = new URLSearchParams()): URLSearchParams {
  for (const key of keys) { const value = filter[key]; if (value) into.set(key, value); else into.delete(key); }
  return into;
}

export const hasFilter = (filter: FleetFilter) => keys.some(key => Boolean(filter[key]));

export function accountMatches(account: FilterableAccount, filter: FleetFilter): boolean {
  if (filter.person && account.identityId !== filter.person) return false;
  if (filter.email && account.ownerEmail.trim().toLowerCase() !== filter.email.trim().toLowerCase()) return false;
  if (filter.provider && (account.kind ?? account.provider ?? "").toLowerCase() !== filter.provider.toLowerCase()) return false;
  if (filter.plan && (account.plan ?? "unknown") !== filter.plan) return false;
  return true;
}

/** Keeps the matching accounts and only the resources that belong to them. */
export function filterSnapshot<S extends { accounts: Array<FilterableAccount & { id: string }>; resources: Array<{ accountId: string | null }> }>(snapshot: S, filter: FleetFilter): S {
  if (!hasFilter(filter)) return snapshot;
  const accounts = snapshot.accounts.filter(account => accountMatches(account, filter));
  const ids = new Set(accounts.map(account => account.id));
  return { ...snapshot, accounts, resources: snapshot.resources.filter(resource => resource.accountId !== null && ids.has(resource.accountId)) };
}

/** Applies the filter to people and their accounts. An account-level filter drops people who have no matching account left. */
export function filterIdentities<I extends { id: string; accounts: FilterableAccount[] }>(identities: I[], filter: FleetFilter): I[] {
  if (!hasFilter(filter)) return identities;
  const accountLevel = Boolean(filter.email || filter.provider || filter.plan);
  return identities
    .filter(identity => !filter.person || identity.id === filter.person)
    .map(identity => ({ ...identity, accounts: identity.accounts.filter(account => accountMatches({ ...account, identityId: identity.id }, { ...filter, person: undefined })) }))
    .filter(identity => !accountLevel || identity.accounts.length > 0);
}
