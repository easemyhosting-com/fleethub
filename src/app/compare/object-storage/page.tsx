"use client";

import { useState } from "react";
import { z } from "zod";
import { formatStorageBytes, parseStorageBytes } from "@/lib/capacity/arithmetic";

const resultSchema = z.object({ candidates: z.array(z.object({
  resourceId: z.string(), name: z.string(), provider: z.string(), accountId: z.string(),
  region: z.string().nullable(), fitVerdict: z.enum(["fits", "tight", "over", "unverified"]),
  totalAllowanceBytes: z.number(), observedBytes: z.number().nullable(), telemetryFreshness: z.string(),
  sharedAllowanceRemainingBytes: z.number().nullable(), projectConsumers: z.array(z.string()),
  usageEvidence: z.object({ source: z.string(), measuredAt: z.string().nullable() }),
  allowanceFreshness: z.string(), reasons: z.array(z.string()), unknowns: z.array(z.string()),
  egressNote: z.string().nullable(), requestNote: z.string().nullable(),
})) });
type Results = z.infer<typeof resultSchema>;
const field = "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-cyan-400";
const labels = { fits: "Capacity fits", tight: "Capacity is tight", over: "Does not fit", unverified: "Fit unknown" };

export default function ObjectStorageComparison() {
  const [results, setResults] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function compare(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setResults(null);
    const data = new FormData(event.currentTarget);
    const value = (key: string) => String(data.get(key) ?? "").trim();
    const size = (key: string) => {
      const raw = value(key);
      if (!raw) return null;
      const parsed = parseStorageBytes(raw);
      if (parsed === null) throw new Error("Enter storage as bytes, GB or GiB, for example 5 GiB.");
      return parsed;
    };
    try {
      const estimatedBytes = size("need");
      if (estimatedBytes === null) throw new Error("Enter how much storage the new workload needs.");
      const pools = [], resources = [];
      for (const index of [0, 1]) {
        const prefix = `candidate-${index}-`;
        const allowance = size(prefix + "allowance");
        if (allowance === null) throw new Error("Enter both account allowances.");
        const measuredAt = value(prefix + "measuredAt");
        const evidence = { source: value(prefix + "source"), measuredAt: measuredAt ? new Date(measuredAt).toISOString() : null };
        const poolId = `pool-${index}`;
        pools.push({ poolId, accountId: value(prefix + "account"), provider: value(prefix + "provider"), product: value(prefix + "product"), allowanceBytes: allowance, inventoryComplete: data.has(prefix + "complete"), evidence });
        const api = value(prefix + "api");
        resources.push({ resourceId: `bucket-${index}`, name: value(prefix + "name"), poolId,
          region: value(prefix + "region") || null, observedBytes: size(prefix + "used"), declaredBytes: null,
          evidence, ...(api ? { supportedApis: [api] } : {}),
          consumers: value(prefix + "consumers").split(",").map(item => item.trim()).filter(Boolean),
          egressNote: value(prefix + "egress") || null, requestNote: value(prefix + "requests") || null });
      }
      setBusy(true);
      const response = await fetch("/api/capacity/object-storage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ need: { estimatedBytes, requiredApi: value("api"), preferredRegion: value("region") || undefined }, pools, resources }) });
      if (response.status === 401 || response.status === 403) throw new Error("Sign in to FleetHub as an operator, then compare again.");
      if (!response.ok) throw new Error("Could not compare. Check the account scopes, source labels and sizes, then try again.");
      setResults(resultSchema.parse(await response.json()));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Comparison unavailable. Try again."); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto max-w-6xl space-y-8 px-4 py-8 text-zinc-100 sm:px-8">
    <header className="max-w-3xl space-y-3">
      <a href="/?tab=limits" className="text-sm text-cyan-300 underline underline-offset-4">Back to FleetHub</a>
      <p className="pt-4 text-xs uppercase tracking-widest text-zinc-500">Resource advisor / manual evidence</p>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Where could this workload live?</h1>
      <p className="text-sm leading-6 text-zinc-400">Compare two object-storage buckets from authorized accounts. Use current account figures. Missing or stale evidence stays unknown. Nothing is saved, reserved or deployed.</p>
    </header>
    <form onSubmit={compare} onChange={() => { setResults(null); setError(""); }} className="space-y-6">
      <fieldset disabled={busy} className="grid gap-4 rounded-xl border border-zinc-700 p-5 sm:grid-cols-3">
        <legend className="px-2 text-sm font-medium">New workload</legend>
        <label className="text-sm text-zinc-300">Storage needed<input name="need" required placeholder="5 GiB" className={field} /></label>
        <label className="text-sm text-zinc-300">Required API<select name="api" className={field}><option value="any">Any / undecided</option><option value="s3_compatible">S3 compatible</option><option value="oci_native">OCI native</option></select></label>
        <label className="text-sm text-zinc-300">Preferred region<input name="region" maxLength={120} className={field} placeholder="Optional" /></label>
      </fieldset>
      <div className="grid gap-6 lg:grid-cols-2">{[0, 1].map(index => {
        const prefix = `candidate-${index}-`;
        return <fieldset key={index} disabled={busy} className="min-w-0 space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
          <legend className="px-2 text-lg font-medium">Candidate {index + 1}</legend>
          <div className="grid gap-4 sm:grid-cols-2">{[
            ["name", "Bucket name", ""], ["provider", "Provider", "e.g. cloudflare"],
            ["account", "Account label", ""], ["product", "Object-storage product", "e.g. r2"],
            ["allowance", "Account storage allowance", "10 GiB"], ["used", "Bucket storage used", "Leave blank if unknown"],
            ["region", "Bucket region", "Optional"], ["source", "Evidence source", "e.g. account console"],
          ].map(([key, label, placeholder]) => <label key={key} className="text-sm text-zinc-300">{label}<input name={prefix + key} required={["name", "provider", "account", "product", "allowance", "source"].includes(key)} maxLength={120} placeholder={placeholder} className={field} /></label>)}</div>
          <label className="block text-sm text-zinc-300">Figures checked at, your local time<input name={prefix + "measuredAt"} type="datetime-local" className={field} /><span className="mt-1 block text-xs text-zinc-500">Use the time you checked both usage and allowance. Blank means unknown.</span></label>
          <label className="block text-sm text-zinc-300">Confirmed bucket API<select name={prefix + "api"} className={field}><option value="">Unknown</option><option value="s3_compatible">S3 compatible</option><option value="oci_native">OCI native</option></select></label>
          <label className="block text-sm text-zinc-300">Services using this bucket<input name={prefix + "consumers"} maxLength={1000} placeholder="Comma-separated labels, if known" className={field} /></label>
          <label className="block text-sm text-zinc-300">Request allowance or constraints<input name={prefix + "requests"} maxLength={120} placeholder="Unknown" className={field} /></label>
          <label className="block text-sm text-zinc-300">Egress allowance or costs<input name={prefix + "egress"} maxLength={120} placeholder="Unknown" className={field} /></label>
          <label className="flex items-start gap-3 border-t border-zinc-800 pt-4 text-sm leading-5 text-zinc-400"><input name={prefix + "complete"} type="checkbox" className="mt-1 shrink-0 accent-cyan-400" />I verified this is the only bucket drawing from this account/product allowance. Leave unchecked if there are other or unknown members.</label>
        </fieldset>;
      })}</div>
      <p className="text-xs leading-5 text-zinc-500">Use separate account/product scopes. Shared multi-bucket pools can be submitted through the API. Catalog figures alone do not prove your account entitlement. Do not enter credentials.</p>
      <button disabled={busy} className="min-h-11 rounded-lg bg-cyan-300 px-6 py-3 font-medium text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300 disabled:opacity-50">{busy ? "Comparing evidence..." : "Compare buckets"}</button>
    </form>
    {error && <p role="alert" className="rounded-lg border border-rose-900 p-4 text-sm text-rose-200">{error}</p>}
    <section aria-live="polite" aria-busy={busy} className="space-y-4">
      {results && <><h2 className="text-xl font-semibold">Comparison evidence</h2><p className="text-sm text-zinc-400">Capacity and API checks only. Review entitlement, access and retention before choosing. No placement decision has been made.</p>
        <div className="grid gap-5 lg:grid-cols-2">{results.candidates.map(item => <article key={item.resourceId} className="min-w-0 space-y-4 rounded-xl border border-zinc-700 p-5 [overflow-wrap:anywhere]">
          <div><p className="text-xs uppercase tracking-wide text-zinc-400">{item.provider} / {item.accountId}</p><h3 className="mt-1 text-xl font-medium">{item.name}</h3><p className="mt-3 text-sm text-cyan-200">{labels[item.fitVerdict]}</p></div>
          <dl className="grid grid-cols-2 gap-3 text-sm"><dt className="text-zinc-400">Account allowance</dt><dd>{formatStorageBytes(item.totalAllowanceBytes)}</dd><dt className="text-zinc-400">Bucket usage</dt><dd>{formatStorageBytes(item.observedBytes)} ({item.telemetryFreshness})</dd><dt className="text-zinc-400">Measured headroom</dt><dd>{formatStorageBytes(item.sharedAllowanceRemainingBytes)}</dd><dt className="text-zinc-400">Region</dt><dd>{item.region || "Unknown"}</dd><dt className="text-zinc-400">Recorded consumers</dt><dd>{item.projectConsumers.join(", ") || "None recorded; actual use unknown"}</dd><dt className="text-zinc-400">Requests</dt><dd>{item.requestNote || "Unknown"}</dd><dt className="text-zinc-400">Egress</dt><dd>{item.egressNote || "Unknown"}</dd></dl>
          <p className="border-t border-zinc-800 pt-3 text-xs leading-5 text-zinc-500">Source: {item.usageEvidence.source}. Checked: {item.usageEvidence.measuredAt || "unknown"}. Allowance: {item.allowanceFreshness}.</p>
          <ul className="list-disc space-y-1 pl-4 text-xs leading-5 text-zinc-400">{[...item.reasons, ...item.unknowns].map((reason, index) => <li key={index}>{reason}</li>)}</ul>
        </article>)}</div></>}
    </section>
  </main>;
}
