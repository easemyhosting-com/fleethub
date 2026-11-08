export interface BillableResource { accountId: string | null; billing?: string }
export interface PlannedAccount { id: string; plan?: string }

/** A free account only has free-tier resources: anything the provider bills for is hidden there. Paid and unknown accounts show everything unless the owner switches paid items off. */
export function applyBilling<S extends { accounts: PlannedAccount[]; resources: BillableResource[] }>(snapshot: S, showPaid: boolean): S {
  const free = new Set(snapshot.accounts.filter(account => account.plan === "free").map(account => account.id));
  const resources = snapshot.resources.filter(resource => resource.billing !== "billable" || (showPaid && !(resource.accountId && free.has(resource.accountId))));
  return resources.length === snapshot.resources.length ? snapshot : { ...snapshot, resources };
}

/** The toggle is only worth showing when some non-free account has a billable resource. */
export function hasPaidResources(snapshot: { accounts: PlannedAccount[]; resources: BillableResource[] }): boolean {
  const free = new Set(snapshot.accounts.filter(account => account.plan === "free").map(account => account.id));
  return snapshot.resources.some(resource => resource.billing === "billable" && !(resource.accountId && free.has(resource.accountId)));
}
