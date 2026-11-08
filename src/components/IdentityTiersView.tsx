"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { IdentityWithAccounts, ProviderAccountDetail } from "@/lib/identity/types";
import { bandStyle, byEmail, byProvider, rollup, usedMeters, visibleResources, type UsageBand } from "@/lib/identity/tiers";

const planChip: Record<string, string> = { free: "border-emerald-700 text-emerald-300", paid: "border-sky-700 text-sky-300", unknown: "border-zinc-700 text-zinc-400" };
const STORAGE_KEY = "fleethub.identity-tiers.closed.v1";

function UsageBox({ name, unit, used, limit, band, pct }: { name: string; unit: string; used?: number; limit: number; band: UsageBand; pct: number | null }) {
  return <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2" title={bandStyle[band].label}>
    <div className="flex flex-wrap justify-between gap-x-2 text-xs"><span className="text-zinc-200">{name}</span><span className="text-zinc-300">{pct === null ? "Usage unknown" : `${pct}% · ${bandStyle[band].label}`}</span></div>
    <div className="mt-1 h-2 overflow-hidden rounded bg-zinc-800" aria-hidden="true"><div className={`h-full ${bandStyle[band].bar}`} style={{ width: `${pct ?? 0}%` }} /></div>
    <p className="mt-1 text-[11px] text-zinc-400">{used === undefined ? "Not reported" : `${used} of ${limit} ${unit}`}</p>
  </div>;
}

function AccountBox({ account, email }: { account: ProviderAccountDetail; email?: string }) {
  const plan = account.plan ?? "unknown";
  const resources = visibleResources(account);
  const meters = usedMeters(account);
  return <div className={`space-y-2 rounded-lg border border-zinc-700 bg-zinc-900/70 p-3 sm:p-4 ${account.archived ? "opacity-75" : ""}`}>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="font-semibold text-white">{account.provider}</span><span className="break-all text-zinc-200">{account.label}</span>
      <span className={`rounded border px-1.5 py-0.5 text-[11px] ${planChip[plan]}`}>{plan === "unknown" ? "Plan not set" : plan}</span>
      {account.archived && <span className="text-[11px] text-zinc-300">Archived</span>}
      {email && <span className="w-full break-all text-xs text-zinc-400 sm:w-auto">{email}</span>}
    </div>
    {meters.length === 0 && resources.length === 0 && <p className="text-xs text-zinc-400">Nothing collected yet{plan === "free" ? " (free account: only free-tier items are listed)" : ""}.</p>}
    {meters.length > 0 && <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3">{meters.map(({ meter, band, pct }) => <UsageBox key={meter.id} name={meter.name} unit={meter.unit} used={meter.currentValue} limit={meter.limitValue} band={band} pct={pct} />)}</div>}
    {resources.length > 0 && <div className="flex flex-wrap gap-2">{resources.map(({ resource, paidOnly }) => <span key={resource.id} className="max-w-full break-words rounded border border-cyan-800 bg-cyan-950/40 px-2 py-1 text-xs text-cyan-100">{resource.name} · {resource.category} · {resource.state}{paidOnly ? " · paid" : ""}</span>)}</div>}
  </div>;
}

function RollupLine({ accounts }: { accounts: ProviderAccountDetail[] }) {
  const r = rollup(accounts);
  if (r.accounts === 0) return <span className="text-xs text-zinc-400">No accounts</span>;
  return <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-300">
    <span>{r.accounts} {r.accounts === 1 ? "account" : "accounts"}: {r.byProvider.map(item => `${item.count} ${item.provider}`).join(" · ")}</span>
    <span>{[r.free && `${r.free} free`, r.paid && `${r.paid} paid`, r.unknownPlan && `${r.unknownPlan} plan not set`].filter(Boolean).join(" · ")}</span>
    {r.worstPct !== null && <span title={`Fullest meter: ${bandStyle[r.worst].label}`}><span aria-hidden="true" className={`mr-1 inline-block h-2 w-2 rounded-full ${bandStyle[r.worst].bar}`} />Fullest meter {r.worstPct}% ({bandStyle[r.worst].label})</span>}
    {r.needsAttention > 0 && <span className="font-medium text-amber-200">{r.needsAttention} {r.needsAttention === 1 ? "account needs" : "accounts need"} attention</span>}
  </span>;
}

function Branch({ title, badge, accounts, open, onToggle, children, level, panelId }: { title: string; badge?: string; accounts: ProviderAccountDetail[]; open: boolean; onToggle: () => void; children: React.ReactNode; level: "person" | "email"; panelId: string }) {
  const headingStyle = level === "person" ? "text-base font-semibold text-white" : "text-sm font-medium text-zinc-100";
  return <div>
    <button type="button" aria-expanded={open} aria-controls={panelId} onClick={onToggle} className="flex min-h-10 w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-2 text-left hover:bg-zinc-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400">
      <ChevronRight className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
      <span className={`${headingStyle} min-w-0 break-all`}>{title}</span>
      {badge && <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-300">{badge}</span>}
      <span className="basis-full pl-6 sm:basis-auto sm:pl-0"><RollupLine accounts={accounts} /></span>
    </button>
    <div id={panelId} hidden={!open} className={`mt-2 space-y-2 border-l-2 pl-2 sm:pl-4 ${level === "person" ? "border-emerald-900/80" : "border-zinc-700"}`}>{children}</div>
  </div>;
}

/** Person, email, provider account, then its resource and quota details. */
export function IdentityTiersView({ identities }: { identities: IdentityWithAccounts[] }) {
  const [mode, setMode] = useState<"email" | "provider">("email");
  const [email, setEmail] = useState("all");
  const [closed, setClosed] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try { return new Set(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "[]") as string[]); } catch { return new Set(); }
  });
  const idPrefix = useId();
  const people = useMemo(() => byEmail(identities), [identities]);
  const allEmails = useMemo(() => [...new Set(people.flatMap(person => person.emails.map(item => item.email)))], [people]);
  const keys = useMemo(() => people.flatMap(person => [person.id, ...person.emails.map(item => `${person.id}:${item.email}`)]), [people]);
  useEffect(() => { try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...closed])); } catch { /* Storage may be unavailable. */ } }, [closed]);
  const toggle = (key: string) => setClosed(prev => { const next = new Set(prev); if (!next.delete(key)) next.add(key); return next; });
  const expandAll = () => setClosed(new Set());
  const collapseAll = () => setClosed(new Set(keys));
  const everyClosed = keys.length > 0 && keys.every(key => closed.has(key));
  const visiblePeople = people.map(person => ({ ...person, shown: person.emails.filter(item => email === "all" || item.email === email) })).filter(person => person.shown.length > 0);
  const providerTiers = byProvider(identities).map(tier => ({ ...tier, accounts: tier.accounts.filter(item => email === "all" || item.email === email) })).filter(tier => tier.accounts.length > 0);
  const hasRows = mode === "email" ? visiblePeople.length > 0 : providerTiers.length > 0;
  return <div className="min-w-0 space-y-4">
    <div className="flex min-w-0 flex-wrap items-center gap-3 text-xs">
      <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5" aria-label="Group identities">
        {(["email", "provider"] as const).map(item => <button key={item} type="button" aria-pressed={mode === item} onClick={() => setMode(item)} className={`min-h-8 rounded-md px-3 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 ${mode === item ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-zinc-200"}`}>{item === "email" ? "By email" : "By provider"}</button>)}
      </div>
      <label className="flex max-w-full flex-wrap items-center gap-1 text-zinc-300">Email <select value={email} onChange={event => setEmail(event.target.value)} className="max-w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400"><option value="all">All</option>{allEmails.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      <button type="button" onClick={everyClosed ? expandAll : collapseAll} disabled={keys.length === 0} className="min-h-8 rounded border border-zinc-700 px-2 py-1 text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400">{everyClosed ? "Expand all" : "Collapse all"}</button>
      <ul className="flex w-full flex-wrap gap-x-3 gap-y-2 text-zinc-300 sm:ml-auto sm:w-auto" aria-label="Usage status legend">{(["unused", "low", "half", "high", "critical", "full"] as const).map(band => <li key={band} className="flex items-center gap-1"><span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded ${bandStyle[band].bar}`} />{bandStyle[band].label}</li>)}</ul>
    </div>
    {!hasRows ? <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-950/50 px-4 py-8 text-center" role="status"><p className="text-sm font-medium text-zinc-200">{identities.length === 0 ? "No identities yet" : "No matching accounts"}</p><p className="mt-1 text-xs text-zinc-400">{identities.length === 0 ? "Add an identity to see its emails, provider accounts, and usage here." : "Try another email filter or switch grouping to find accounts."}</p></div> : mode === "email" ? visiblePeople.map(person => {
      const personPanelId = `${idPrefix}-person-${encodeURIComponent(person.id)}`;
      return <section key={person.id} className="min-w-0 space-y-2 rounded-xl border border-zinc-700 bg-zinc-950/40 p-2 sm:p-3">
        <Branch title={person.name} accounts={person.shown.flatMap(item => item.accounts)} level="person" panelId={personPanelId} open={!closed.has(person.id)} onToggle={() => toggle(person.id)}>
          {person.shown.map(item => {
            const emailPanelId = `${idPrefix}-email-${encodeURIComponent(person.id)}-${encodeURIComponent(item.email)}`;
            return <Branch key={item.email} title={item.email} badge={item.isPrimary ? "Primary" : undefined} accounts={item.accounts} level="email" panelId={emailPanelId} open={!closed.has(`${person.id}:${item.email}`)} onToggle={() => toggle(`${person.id}:${item.email}`)}>
              {item.accounts.length === 0 ? <p className="rounded-md border border-dashed border-zinc-800 px-3 py-3 text-xs text-zinc-400">No provider accounts are linked to this email yet.</p> : item.accounts.map(account => <AccountBox key={account.id} account={account} />)}
            </Branch>;
          })}
        </Branch>
      </section>;
    }) : providerTiers.map(tier => <section key={tier.provider} className="min-w-0 space-y-3 rounded-xl border border-zinc-700 bg-zinc-950/40 p-3 sm:p-4">
      <h3 className="text-base font-semibold text-white">{tier.provider}</h3>
      {tier.accounts.map(item => <AccountBox key={item.account.id} account={item.account} email={item.email} />)}
    </section>)}
  </div>;
}
