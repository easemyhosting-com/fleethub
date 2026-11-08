"use client";
import { useState } from "react";
import type { HostProbe, ProbeSuggestion } from "@/lib/connectors/probe";
import { hostKey } from "@/lib/capacity/addresses";

const field = "mt-1 w-full min-w-0 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400";
const button = "rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50";
/** Credentials stay inside the selected probe card and clear when the card closes. Reachability alone never creates a connector. */
export function ProbeConnectorForm({ host, suggestion, hosts, onSaved, onCancel }: { host: HostProbe; suggestion: ProbeSuggestion; hosts: Array<{ id: string; name: string }>; onSaved: () => Promise<void>; onCancel: () => void }) {
  const matches = hosts.filter(item => host.name && hostKey(item.name) === hostKey(host.name));
  const [hostName, setHostName] = useState(matches.length === 1 ? matches[0].name : "");
  const [token, setToken] = useState(""), [basicUser, setBasicUser] = useState(""), [caPem, setCaPem] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/connectors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: suggestion.kind, label: hostName || host.ip, hostName, url: suggestion.url, allowHttp: suggestion.allowHttp, ...(token ? { secret: token } : {}), ...(basicUser ? { basicUser } : {}), ...(caPem ? { caPem } : {}) }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || `Save failed (${response.status}).`);
      setToken(""); setCaPem(""); setBasicUser("");
      await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save connector."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="space-y-3 border-t border-zinc-700 pt-3">
    <p className="break-all text-xs text-zinc-300">Connect {suggestion.url}</p>
    <label className="block text-xs text-zinc-300">FleetHub host
      <select required value={hostName} onChange={e => setHostName(e.target.value)} className={field} disabled={busy}>
        <option value="">Choose a compute resource</option>{hosts.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}
      </select></label>
    {!hosts.length && <p className="text-xs text-amber-200">No compute resources available. Scan a provider account, or retry when storage recovers.</p>}
    {suggestion.kind === "prometheus" && <label className="block text-xs text-zinc-300">Basic-auth username, if needed<input value={basicUser} onChange={e => setBasicUser(e.target.value)} autoComplete="off" className={field} disabled={busy} /></label>}
    <label className="block text-xs text-zinc-300">{suggestion.kind === "kubernetes" ? "Read-only token" : "Token or password, if needed"}<input required={suggestion.kind === "kubernetes"} type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" className={field} disabled={busy} /></label>
    {!suggestion.allowHttp && <label className="block text-xs text-zinc-300">CA certificate PEM, if needed<textarea rows={3} value={caPem} onChange={e => setCaPem(e.target.value)} className={field} disabled={busy} /></label>}
    {suggestion.allowHttp && <p className="text-xs text-amber-200">This endpoint uses unencrypted HTTP. Save only for a trusted private metrics endpoint or read-only Docker proxy.</p>}
    <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy} className={`${button} border-emerald-800 text-emerald-200`}>{busy ? "Saving…" : "Save connector here"}</button><button type="button" disabled={busy} onClick={onCancel} className={button}>Cancel</button></div>
    {error && <p role="alert" className="text-xs text-rose-200">{error}</p>}
  </form>;
}
