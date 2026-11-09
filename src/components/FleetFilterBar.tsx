"use client";

import { hasFilter, type FleetFilter } from "@/lib/fleet/filters";
import type { PickerIdentity } from "@/lib/identity/picker";
import type { RefObject } from "react";

export interface FleetProjectOption { slug: string; name: string }

export function FleetProjectSelect({ projects, project, onChange }: {
  projects: FleetProjectOption[];
  project?: string;
  onChange: (value?: string) => void;
}) {
  if (!projects.length && !project) return null;
  return <label className={field}>Project
    <select aria-label="Filter by project" value={project ?? ""} onChange={event => onChange(event.target.value || undefined)} className={select}>
      <option value="">All projects</option>
      {project && !projects.some(item => item.slug === project) && <option value={project}>{project}</option>}
      {projects.map(item => <option key={item.slug} value={item.slug}>{item.name}</option>)}
    </select>
  </label>;
}

interface Props { projects: FleetProjectOption[]; searchInputRef?: RefObject<HTMLInputElement | null>; search: string; onSearch: (value: string) => void; attention: boolean; onAttention: (value: boolean) => void; filter: FleetFilter; onChange: (filter: FleetFilter) => void; identities: PickerIdentity[] | null; providers: string[]; resultCount?: number; paid?: { show: boolean; onChange: (show: boolean) => void } }

const select = "min-h-11 w-full min-w-0 max-w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-base text-zinc-100 sm:min-h-0 sm:w-auto sm:max-w-48 sm:text-sm";
const field = "flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-1";

/** Person, Email, Provider and Plan: one bar above every fleet view. Picking a person narrows the email list to theirs. */
export function FleetFilterBar({ projects, searchInputRef, search, onSearch, attention, onAttention, filter, onChange, identities, providers, resultCount, paid }: Props) {
  const people = identities ?? [];
  const person = people.find(item => item.id === filter.person);
  const emails = person ? person.emails : [...new Set(people.flatMap(item => item.emails))].sort();
  const set = (patch: FleetFilter) => onChange({ ...filter, ...patch });
  const count = resultCount ?? 0;
  return <div role="search" aria-label="Fleet filters" className="mb-4 grid grid-cols-2 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-400 sm:flex sm:flex-wrap">
    <label className={`col-span-2 ${field}`}>Search fleet
      <input ref={searchInputRef} type="search" value={search} maxLength={256} onChange={event => onSearch(event.target.value)} placeholder="Name, provider or problem" className={select} />
    </label>
    <label className="col-span-2 flex min-h-11 items-center gap-2 sm:col-auto sm:min-h-0">
      <input type="checkbox" checked={attention} onChange={event => onAttention(event.target.checked)} className="h-4 w-4" /> Needs attention
    </label>
    <FleetProjectSelect projects={projects} project={filter.project} onChange={project => set({ project })} />
    <label className={field}>Person
      <select aria-label="Filter by person" value={filter.person ?? ""} onChange={event => set({ person: event.target.value || undefined, email: undefined })} className={select}>
        <option value="">All people</option>{people.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}
      </select></label>
    <label className={field}>Email
      <select aria-label="Filter by email" value={filter.email ?? ""} onChange={event => set({ email: event.target.value || undefined })} className={select}>
        <option value="">Any email</option>
        {emails.map(email => <option key={email} value={email}>{email}</option>)}
      </select></label>
    <label className={field}>Provider
      <select aria-label="Filter by provider" value={filter.provider ?? ""} onChange={event => set({ provider: event.target.value || undefined })} className={select}>
        <option value="">All providers</option>{providers.map(kind => <option key={kind} value={kind}>{kind}</option>)}
      </select></label>
    <label className={field}>Plan
      <select aria-label="Filter by plan" value={filter.plan ?? ""} onChange={event => set({ plan: event.target.value || undefined })} className={select}>
        <option value="">Any plan</option><option value="free">Free</option><option value="paid">Paid</option><option value="unknown">Unknown</option>
      </select></label>
    {paid && <label className="col-span-2 flex min-h-11 items-center gap-2 sm:col-auto sm:min-h-0"><input type="checkbox" checked={paid.show} onChange={event => paid.onChange(event.target.checked)} className="h-4 w-4" />Show paid resources</label>}
    {(hasFilter(filter) || search || attention) && <button type="button" onClick={() => { onChange({}); onSearch(""); onAttention(false); }} className="col-span-2 min-h-11 rounded border border-zinc-700 px-2 py-1 text-zinc-200 sm:col-auto sm:min-h-0">Clear fleet filters</button>}
    <p role="status" aria-live="polite" aria-atomic="true" className="col-span-2 text-zinc-400 sm:col-auto sm:ml-auto">{count} {count === 1 ? "account matches" : "accounts match"}</p>
  </div>;
}
