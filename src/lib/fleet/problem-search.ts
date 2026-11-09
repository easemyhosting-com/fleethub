import type { FleetAccount, FleetResource, FleetSnapshot } from "@/lib/inventory/model";
import { tileState } from "@/lib/fleetmap/model";

export function filterFleetProblems(snapshot: FleetSnapshot, search: string, attention: boolean): FleetSnapshot {
  const query = search.trim().toLowerCase();
  if (!query && !attention) return snapshot;

  const matches = (fields: Array<string | null | undefined>) =>
    !query || fields.some(field => field?.toLowerCase().includes(query));
  const accountProblem = (account: FleetAccount) =>
    Boolean(account.collection.errorCode) || ["stale", "needs_credentials", "error"].includes(account.collection.state) ||
    ["degraded", "error"].includes(account.health);
  const accountsWithProblems = new Set(snapshot.accounts.filter(accountProblem).map(account => account.id));
  const matchingAccounts = new Set(snapshot.accounts.filter(account => matches([
    account.id, account.label, account.kind, account.ownerEmail, account.loginEmail, account.health,
    account.collection.errorCode?.replaceAll("_", " "), account.collection.message,
  ])).map(account => account.id));
  const shownAccounts = new Set(snapshot.accounts.filter(account =>
    matchingAccounts.has(account.id) && (!attention || accountsWithProblems.has(account.id))
  ).map(account => account.id));

  const resources = snapshot.resources.filter(resource => {
    const accountMatches = resource.accountId !== null && matchingAccounts.has(resource.accountId);
    const accountHasProblem = resource.accountId !== null && accountsWithProblems.has(resource.accountId);
    if (attention && !accountHasProblem && !resourceProblem(resource)) return false;
    if (!accountMatches && !matches([
      resource.id, resource.name, resource.nativeId, resource.provider, resource.category, resource.region,
      resource.presence, resource.freshness, resource.state, tileState(resource),
    ])) return false;
    if (resource.accountId) shownAccounts.add(resource.accountId);
    return true;
  });

  return { ...snapshot, accounts: snapshot.accounts.filter(account => shownAccounts.has(account.id)), resources };
}

function resourceProblem(resource: FleetResource): boolean {
  const state = tileState(resource);
  return state === "missing" || state === "unknown" || resource.freshness === "stale";
}
