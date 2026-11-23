"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FREEBIES, filterFreebies, freebieFacets, freebieFilterToParams, parseFreebieFilter,
  type FreebieEntry, type FreebieFilter, type FreebieFitTag,
} from "@/lib/catalog/freebies";

const select = "min-h-11 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-cyan-400 sm:min-h-0";
const label = "flex min-w-0 flex-col gap-1 text-xs text-zinc-400";
const words = (value: string) => value.replaceAll("_", " ").replaceAll("-", " ");
const statusTone = { verified: "border-emerald-800 text-emerald-300", marketing: "border-amber-800 text-amber-300", unverified: "border-rose-800 text-rose-300" };
const scopeLabel = { per_tenancy: "Per tenancy", per_account: "Per account", per_region: "Per region", per_resource: "Per resource" };

function limitHeadline(entry: FreebieEntry) {
  if (entry.limit.type === "none") return "No free allowance";
  if (entry.limit.value === null) return "No stated cap";
  return `${entry.limit.value.toLocaleString("en-US")} ${entry.limit.unit ?? ""}`.trim();
}

export default function FreebiesCatalog() {
  const facets = useMemo(() => freebieFacets(FREEBIES), []);
  const [filter, setFilter] = useState<FreebieFilter>({});
  useEffect(() => { setFilter(parseFreebieFilter(new URLSearchParams(window.location.search))); }, []);
  const update = (patch: Partial<FreebieFilter>) => {
    const next = { ...filter, ...patch };
    setFilter(next);
    const query = freebieFilterToParams(next).toString();
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  };
  const toggleTag = (tag: FreebieFitTag) => {
    const tags = filter.fitTags ?? [];
    const next = tags.includes(tag) ? tags.filter(item => item !== tag) : [...tags, tag];
    update({ fitTags: next.length ? next : undefined });
  };
  const results = filterFreebies(FREEBIES, filter);

  return <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 text-zinc-100 sm:px-8">
    <header className="max-w-3xl space-y-3">
      <a href="/?tab=limits" className="text-sm text-cyan-300 underline underline-offset-4">Back to FleetHub</a>
      <p className="pt-4 text-xs uppercase tracking-widest text-zinc-500">Catalog / provider free tiers</p>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Cloud freebies</h1>
      <p className="text-sm leading-6 text-zinc-400">Free-tier allowances with their source and the date each was checked. Catalog figures are provider statements, not your measured usage or proof of your account entitlement. Provider account rules still apply.</p>
    </header>

    <div role="search" aria-label="Freebie filters" className="grid gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 sm:grid-cols-3 lg:grid-cols-6">
      <label className={`${label} sm:col-span-3 lg:col-span-6`}>Search
        <input type="search" maxLength={256} value={filter.search ?? ""} onChange={event => update({ search: event.target.value || undefined })} placeholder="Service, limit, caveat or use, e.g. backup" className={select} />
      </label>
      <label className={label}>Provider
        <select value={filter.provider ?? ""} onChange={event => update({ provider: event.target.value || undefined })} className={select}>
          <option value="">All providers</option>{facets.providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
      <label className={label}>Category
        <select value={filter.category ?? ""} onChange={event => update({ category: (event.target.value || undefined) as FreebieFilter["category"] })} className={select}>
          <option value="">All categories</option>{facets.categories.map(item => <option key={item} value={item}>{words(item)}</option>)}
        </select></label>
      <label className={label}>Limit type
        <select value={filter.limitType ?? ""} onChange={event => update({ limitType: (event.target.value || undefined) as FreebieFilter["limitType"] })} className={select}>
          <option value="">Any limit</option>{facets.limitTypes.map(item => <option key={item} value={item}>{words(item)}</option>)}
        </select></label>
      <label className={label}>Region
        <select value={filter.homeRegionOnly === undefined ? "" : String(filter.homeRegionOnly)} onChange={event => update({ homeRegionOnly: event.target.value === "" ? undefined : event.target.value === "true" })} className={select}>
          <option value="">Any</option><option value="true">Home region only</option><option value="false">Any region</option>
        </select></label>
      <label className={label}>Verification
        <select value={filter.verification ?? ""} onChange={event => update({ verification: (event.target.value || undefined) as FreebieFilter["verification"] })} className={select}>
          <option value="">Any status</option>{facets.verifications.map(item => <option key={item} value={item}>{words(item)}</option>)}
        </select></label>
      <div className="flex items-end"><button type="button" onClick={() => update({ search: undefined, provider: undefined, category: undefined, limitType: undefined, homeRegionOnly: undefined, verification: undefined, fitTags: undefined })} className="min-h-11 w-full rounded border border-zinc-700 px-3 text-sm text-zinc-300 hover:bg-zinc-800 sm:min-h-9">Clear filters</button></div>
      <fieldset className="sm:col-span-3 lg:col-span-6">
        <legend className="mb-2 text-xs text-zinc-400">Fits my fleet (all selected must match)</legend>
        <div className="flex flex-wrap gap-2">{facets.fitTags.map(tag => {
          const on = filter.fitTags?.includes(tag) ?? false;
          return <button key={tag} type="button" aria-pressed={on} onClick={() => toggleTag(tag)} className={`rounded-full border px-3 py-1 text-xs ${on ? "border-cyan-400 bg-cyan-950 text-cyan-200" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"}`}>{words(tag)}</button>;
        })}</div>
      </fieldset>
    </div>

    <p aria-live="polite" className="text-sm text-zinc-400">{results.length} of {FREEBIES.length} entries</p>
    {results.length === 0 && <p className="rounded-lg border border-zinc-800 p-6 text-sm text-zinc-400">No freebies match. Remove a filter or shorten the search.</p>}
    <ul className="grid gap-4 lg:grid-cols-2">{results.map(entry => <li key={entry.id} className="min-w-0 space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><p className="text-xs uppercase tracking-wide text-zinc-500">{entry.providerName} / {words(entry.category)}</p><h2 className="mt-1 text-lg font-medium">{entry.service}</h2></div>
        <span className={`rounded border px-2 py-0.5 text-xs ${statusTone[entry.verification]}`}>{entry.verification}</span>
      </div>
      <p className="font-mono text-xl text-cyan-200">{limitHeadline(entry)}</p>
      <p className="text-sm leading-6 text-zinc-300">{entry.limit.note}</p>
      <p className="text-xs text-zinc-400">{scopeLabel[entry.scope]} · {entry.homeRegionOnly === true ? "Home region only" : entry.homeRegionOnly === false ? "Any region" : "Region rule not stated"} · {words(entry.limit.type)}</p>
      {entry.caveats.length > 0 && <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-amber-200/80">{entry.caveats.map((caveat, index) => <li key={index}>{caveat.text}</li>)}</ul>}
      {entry.suggestedUses.length > 0 && <p className="text-xs leading-5 text-zinc-400"><span className="text-zinc-300">Uses:</span> {entry.suggestedUses.join("; ")}</p>}
      <p className="border-t border-zinc-800 pt-3 text-xs text-zinc-500"><a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline underline-offset-2">Source</a> · checked {entry.verifiedAt}</p>
    </li>)}</ul>
  </main>;
}
