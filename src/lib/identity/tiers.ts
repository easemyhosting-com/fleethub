import type { IdentityWithAccounts, LinkedQuotaMeter, LinkedResource, ProviderAccountDetail } from "./types";

export type UsageBand = "unused" | "low" | "half" | "high" | "critical" | "full" | "unknown";

/** Colour bands the owner asked for: under 50%, 50%+, 80%+, 90%+ and fully used. */
export function usageBand(used: number | undefined, limit: number): UsageBand {
  if (used === undefined || !Number.isFinite(used) || !(limit > 0)) return "unknown";
  const pct = (used / limit) * 100;
  if (pct <= 0) return "unused";
  if (pct >= 100) return "full";
  if (pct >= 90) return "critical";
  if (pct >= 80) return "high";
  if (pct >= 50) return "half";
  return "low";
}

export const bandStyle: Record<UsageBand, { bar: string; label: string }> = {
  unused: { bar: "bg-zinc-600", label: "Not used" },
  low: { bar: "bg-emerald-500", label: "Under 50%" },
  half: { bar: "bg-yellow-400", label: "50% or more" },
  high: { bar: "bg-orange-500", label: "80% or more" },
  critical: { bar: "bg-red-500", label: "90% or more" },
  full: { bar: "bg-fuchsia-600", label: "Fully used" },
  unknown: { bar: "bg-zinc-700", label: "Usage unknown" },
};

const isPaidOnly = (resource: LinkedResource) => resource.billing === "billable" || resource.tags.includes("paid");

/** What an account shows: a free account hides paid-only resources; a paid or unknown one shows everything, with paid-only ones marked. */
export function visibleResources(account: ProviderAccountDetail): Array<{ resource: LinkedResource; paidOnly: boolean }> {
  return account.resources
    .map(resource => ({ resource, paidOnly: isPaidOnly(resource) }))
    .filter(item => account.plan !== "free" || !item.paidOnly);
}

export function usedMeters(account: ProviderAccountDetail): Array<{ meter: LinkedQuotaMeter; band: UsageBand; pct: number | null }> {
  return account.quotaMeters.map(meter => ({
    meter, band: usageBand(meter.currentValue, meter.limitValue),
    pct: meter.currentValue !== undefined && meter.limitValue > 0 ? Math.min(100, Math.round((meter.currentValue / meter.limitValue) * 100)) : null,
  }));
}

export interface EmailNode { email: string; isPrimary: boolean; accounts: ProviderAccountDetail[] }
export interface PersonTier { id: string; name: string; emails: EmailNode[] }

/** Person, then email, then the provider accounts under that email. Accounts whose email is not a contact of the person get their own row. */
export function byEmail(identities: IdentityWithAccounts[]): PersonTier[] {
  return identities.map(person => {
    const rows = new Map<string, EmailNode>();
    for (const contact of person.contacts.filter(item => item.kind === "email")) rows.set(contact.value.toLowerCase(), { email: contact.value, isPrimary: contact.isPrimary, accounts: [] });
    const byContact = new Map(person.contacts.map(contact => [contact.id, contact.value.toLowerCase()]));
    for (const account of person.accounts) {
      const key = (account.contactId ? byContact.get(account.contactId) : undefined) ?? (account.ownerEmail || "no email").toLowerCase();
      const row = rows.get(key) ?? { email: account.ownerEmail || "no email", isPrimary: false, accounts: [] };
      row.accounts.push(account); rows.set(key, row);
    }
    return { id: person.id, name: person.displayName, emails: [...rows.values()] };
  });
}

export interface ProviderTier { provider: string; accounts: Array<{ email: string; person: string; account: ProviderAccountDetail }> }

/** The other view: one provider, then every email and account that has something there. */
export function byProvider(identities: IdentityWithAccounts[]): ProviderTier[] {
  const out = new Map<string, ProviderTier>();
  for (const person of identities) for (const account of person.accounts) {
    const tier = out.get(account.provider) ?? { provider: account.provider, accounts: [] };
    tier.accounts.push({ email: account.ownerEmail, person: person.displayName, account }); out.set(account.provider, tier);
  }
  return [...out.values()].sort((a, b) => a.provider.localeCompare(b.provider));
}

export interface Rollup {
  accounts: number;
  byProvider: Array<{ provider: string; count: number }>;
  free: number;
  paid: number;
  unknownPlan: number;
  resources: number;
  worst: UsageBand;
  worstPct: number | null;
  needsAttention: number;
}

const bandRank: Record<UsageBand, number> = { unknown: -1, unused: 0, low: 1, half: 2, high: 3, critical: 4, full: 5 };

/** One line of truth for a group of accounts: how many, which providers, free or paid, how full the fullest meter is, and how many are unhealthy. */
export function rollup(accounts: ProviderAccountDetail[]): Rollup {
  const providers = new Map<string, number>();
  let worst: UsageBand = "unknown";
  let worstPct: number | null = null;
  let resources = 0;
  for (const account of accounts) {
    providers.set(account.provider, (providers.get(account.provider) ?? 0) + 1);
    resources += visibleResources(account).length;
    for (const { band, pct } of usedMeters(account)) {
      if (bandRank[band] > bandRank[worst]) worst = band;
      if (pct !== null && (worstPct === null || pct > worstPct)) worstPct = pct;
    }
  }
  return {
    accounts: accounts.length,
    byProvider: [...providers].map(([provider, count]) => ({ provider, count })).sort((a, b) => a.provider.localeCompare(b.provider)),
    free: accounts.filter(account => account.plan === "free").length,
    paid: accounts.filter(account => account.plan === "paid").length,
    unknownPlan: accounts.filter(account => !account.plan || account.plan === "unknown").length,
    resources, worst, worstPct,
    needsAttention: accounts.filter(account => !account.archived && (account.health === "degraded" || account.health === "error")).length,
  };
}
