"use client";

import { resourceUsage } from "@/lib/fleet/usage";
import { bandStyle } from "@/lib/identity/tiers";
import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { FleetAccount, FleetSnapshot } from "@/lib/inventory/model";
import { InventoryAccountsPanel } from "@/components/InventoryAccountsPanel";
import { OnboardingWelcomeView } from "@/components/OnboardingWelcomeView";

interface Props {
  snapshot: FleetSnapshot;
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
  onOpenOnboarding: (providerId?: string) => void;
  onOpenAuth: () => void;
  onConnectCredentials?: (account: FleetAccount) => void;
  filtered?: boolean;
}

export function FleetOverviewHub({ snapshot, onRefresh, isRefreshing, onOpenOnboarding, onOpenAuth, onConnectCredentials, filtered }: Props) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [owner, setOwner] = useState("");
  const [query, setQuery] = useState("");
  const owners = useMemo(() => [...new Set(snapshot.accounts.map(account => account.ownerEmail))].sort(), [snapshot.accounts]);
  const resources = snapshot.resources.filter(resource => {
    const account = snapshot.accounts.find(item => item.id === resource.accountId);
    return (!accountId || resource.accountId === accountId) && (!owner || account?.ownerEmail === owner) && (!query || `${resource.name} ${resource.nativeId ?? ""} ${resource.provider}`.toLowerCase().includes(query.toLowerCase()));
  });
  if (!filtered && snapshot.accounts.length === 0 && snapshot.resources.length === 0) return <OnboardingWelcomeView onOpenOnboarding={onOpenOnboarding} onRefreshData={onRefresh} onOpenAuth={onOpenAuth} />;
  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-5"><div><h1 className="text-xl font-semibold text-white">Registered inventory</h1><p className="text-sm text-zinc-400">{snapshot.accounts.length} accounts · {snapshot.resources.length} resources · Snapshot {new Date(snapshot.timestamp).toLocaleString()}</p></div><button type="button" onClick={onRefresh} disabled={isRefreshing} className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-200 disabled:opacity-50"><RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""}/>Read latest state</button></header>
    <InventoryAccountsPanel onConnectCredentials={onConnectCredentials} accounts={snapshot.accounts} worker={snapshot.worker} onReload={onRefresh} onSelectAccount={setAccountId} selectedAccountId={accountId}/>
    <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-white">Resources</h2><p className="text-xs text-zinc-400">Missing and stale resources remain visible until the account is checked again.</p></div><div className="flex flex-wrap gap-2"><select aria-label="Filter by account" value={accountId ?? ""} onChange={e => setAccountId(e.target.value || null)} className="rounded border border-zinc-700 bg-zinc-900 p-2 text-xs"><option value="">All accounts</option>{snapshot.accounts.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}</select><select aria-label="Filter by owner" value={owner} onChange={e => setOwner(e.target.value)} className="rounded border border-zinc-700 bg-zinc-900 p-2 text-xs"><option value="">All owners</option>{owners.map(value => <option key={value} value={value}>{value}</option>)}</select><input aria-label="Search resources" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search resources" className="rounded border border-zinc-700 bg-zinc-900 p-2 text-xs"/></div></div>
    {resources.length === 0 ? <p className="text-sm text-zinc-400">No resources match these filters. Registered accounts do not imply active resources.</p> : <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{resources.map(resource => <article key={resource.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4"><div className="flex items-start justify-between gap-2"><h3 className="font-medium text-white">{resource.name}</h3><span className="text-xs text-zinc-400">{resource.provider}</span></div><p className="mt-1 text-xs text-zinc-400">{resource.category}{resource.region ? ` · ${resource.region}` : ""}</p><p className="mt-2 text-xs text-zinc-300">{resource.inventorySource === "manual" ? "Manual · unverified" : `${resource.presence} · ${resource.freshness}`}{resource.presence === "present" && resource.freshness === "current" ? ` · ${resource.state}` : ""}</p>{resourceUsage(resource).map(item => <div key={item.key} className="mt-2 text-xs text-zinc-400"><div className="flex justify-between"><span>{item.label}</span><span>{item.used} / {item.limit} {item.unit}</span></div><div className="mt-1 h-1.5 rounded bg-zinc-800"><div role="img" aria-label={`${item.pct}% ${bandStyle[item.band].label}`} className={`h-1.5 rounded ${bandStyle[item.band].bar}`} style={{ width: `${Math.max(item.pct, 2)}%` }} /></div></div>)}{resource.billing === "billable" && <p className="mt-2 text-xs text-fuchsia-300">Paid</p>}{resource.isProtected && <p className="mt-2 text-xs text-amber-300">Protected · inventory only</p>}<p className="mt-1 text-xs text-zinc-500">Last seen {resource.lastSeenAt ? new Date(resource.lastSeenAt).toLocaleString() : "never"}</p></article>)}</div>}
    </section>
  </div>;
}
