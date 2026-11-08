"use client";
import { use, useEffect, useState } from "react";
import type { HostCapacity as Host } from "@/lib/capacity/host";
import { hostKey } from "@/lib/capacity/addresses";
import { HostCard } from "@/components/HostCapacity";
import { HostLabel } from "@/components/HostLabel";

export default function HostPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const [host, setHost] = useState<Host | null | undefined>(undefined), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void fetch("/api/capacity/hosts", { cache: "no-store" }).then(async response => {
      const body = await response.json().catch(() => ({})) as { hosts?: Host[]; error?: string };
      if (response.status === 401) throw new Error("Sign in to FleetHub first, then reload this page.");
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
      const wanted = decodeURIComponent(key);
      if (active) setHost((body.hosts ?? []).find(item => item.hostId === wanted || hostKey(item.name) === hostKey(wanted)) ?? null);
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Could not load this server."); });
    return () => { active = false; };
  }, [key]);
  return <main className="mx-auto max-w-4xl space-y-4 p-6 text-zinc-100">
    <a href="/" className="text-xs text-zinc-400 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">← FleetHub</a>
    {error && <p role="alert" className="text-sm text-rose-200">{error}</p>}
    {host === undefined && !error && <p className="text-sm text-zinc-400">Loading…</p>}
    {host === null && <p className="text-sm text-zinc-300">No server called “{decodeURIComponent(key)}” is registered.</p>}
    {host && <><h1 className="text-xl font-semibold text-white"><HostLabel name={host.name} addresses={host.addresses} /></h1><HostCard host={host} detailed /></>}
  </main>;
}
