"use client";
import { useCallback, useEffect, useState } from "react";
import { CollectionDiagnostics } from "./CollectionDiagnostics";
import { connectorDiagnostics } from "@/lib/connectors/diagnostics";
import type { Discovery } from "@/lib/gitops/discover";
import { measuredHostName, type HostCapacity, type ScopeUsage } from "@/lib/connectors/prometheus";
import { HostLabel } from "@/components/HostLabel";
import { addressKind, hostKey } from "@/lib/capacity/addresses";
import { DiscoveryReview } from "@/components/DiscoveryReview";
import { ProbeConnectorForm } from "@/components/ProbeConnectorForm";
import { ConnectorSchedule } from "@/components/ConnectorSchedule";
import type { HostProbe, ProbeSuggestion } from "@/lib/connectors/probe";
import { connectorKindLabel, connectorLastScanLabel, defaultConnectorSelection } from "@/lib/connectors/view";

const field = "mt-1 min-w-0 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400";
const button = "rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50";
const chip = "inline-flex rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300";
type Kind = "kubernetes" | "docker" | "prometheus";
type Connector = { id: string; kind: Kind; label: string; hostName: string; url: string; lastScanAt: string | null; lastStatus: string | null; lastSummary: { unregistered?: string[] } | null; scanIntervalMinutes: number; scanRequested: boolean; hasRescanKey: boolean };
type Scan = { kind: Kind; discovery?: Discovery; usage?: { hosts: HostCapacity[]; namespaces: ScopeUsage[]; composeProjects: ScopeUsage[]; containers?: { instance: string; name: string; cpuCores: number | null; memMi: number | null }[] }; applied?: { created: number; updated: number; placements: number; unresolvedHosts: string[]; links: { gitops: number; inferred: number; suggested: number }; projects?: string[] }; usageRecorded?: number };
const help: Record<Kind, string> = {
  kubernetes: "Use a read-only service account token. Works with Flux, Argo CD, Helm or plain kubectl. The RBAC example lives in docs/56-live-connectors.md. Kubernetes Secrets are never read.",
  docker: "Point this at a read-only Docker socket proxy, never the raw Docker socket. Plain HTTP is allowed only for a private-network socket proxy and should be enabled deliberately.",
  prometheus: "Use any Prometheus-compatible URL, including Grafana Cloud or a Grafana datasource proxy. Basic auth is optional; enter the username and use the token field as its password.",
};
function storageError(status: number, detail?: string) { if (status === 400) return detail || "Check the connector fields and URL."; if (status === 401) return "Sign in again to manage connectors."; if (status === 403) return detail || "Your account is not allowed to manage connectors."; if (status === 503) return detail || "Connector storage is unavailable. Try again when FleetHub is ready."; return detail || `Request failed (${status}).`; }
function formatCpu(value: number | null) { return value === null ? "unknown" : `${value.toFixed(2)} cores`; }
function formatMi(value: number | null) { return value === null ? "unknown" : `${value.toLocaleString()} MiB`; }

export function ConnectorsPanel({ onRegistered }: { onRegistered: () => Promise<void> | void }) {
  const [knownHosts, setKnownHosts] = useState<Array<{ id: string; name: string }>>([]);
  const [connectors, setConnectors] = useState<Connector[]>([]), [kind, setKind] = useState<Kind>("kubernetes");
  const [form, setForm] = useState({ label: "", hostName: "", url: "", token: "", caPem: "", allowHttp: false, basicUser: "" });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [summary, setSummary] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null), [scanning, setScanning] = useState<string | null>(null);
  const [scan, setScan] = useState<{ id: string; result: Scan } | null>(null), [selected, setSelected] = useState<string[]>([]);
  const [probeSelection, setProbeSelection] = useState<{ ip: string; port: number } | null>(null);
  const [peerText, setPeerText] = useState(""), [finding, setFinding] = useState(false), [found, setFound] = useState<HostProbe[] | null>(null);
  async function findHosts() {
    setProbeSelection(null); setFinding(true); setError(""); setSummary("");
    try {
      const response = await fetch("/api/connectors/probe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: peerText }) });
      const body = await response.json().catch(() => ({})) as { hosts?: HostProbe[]; error?: string };
      if (!response.ok) throw new Error(body.error || `Probe failed (${response.status}).`);
      setFound(body.hosts ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Probe failed."); }
    finally { setFinding(false); }
  }
  function useSuggestion(host: HostProbe, suggestion: ProbeSuggestion) {
    const name = host.name ?? "";
    setKind(suggestion.kind);
    setForm(current => ({ ...current, label: name || host.ip, hostName: name, url: suggestion.url, allowHttp: suggestion.allowHttp, token: "", basicUser: "", caPem: "" }));
    setSummary(`Form filled for ${suggestion.label} at ${host.ip}. Any credential typed earlier was cleared. Check the host name matches the machine in FleetHub, add the credential, then save.`);
  }
  const refresh = useCallback(async () => {
    try { const response = await fetch("/api/connectors", { cache: "no-store" }); const body = await response.json().catch(() => ({})) as { connectors?: Connector[]; hosts?: Array<{ id: string; name: string }>; error?: string }; if (!response.ok) throw new Error(storageError(response.status, body.error)); setConnectors(body.connectors ?? []); setKnownHosts(body.hosts ?? []); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load connectors."); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  async function add(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setSummary("");
    try {
      const payload: Record<string, unknown> = { kind, label: form.label, hostName: form.hostName, url: form.url, allowHttp: form.allowHttp };
      if (form.token) payload.secret = form.token;
      if (form.caPem) payload.caPem = form.caPem;
      if (kind === "prometheus" && form.basicUser) payload.basicUser = form.basicUser;
      const response = await fetch("/api/connectors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(storageError(response.status, body.error));
      setForm(current => ({ ...current, label: "", hostName: "", url: "", token: "", caPem: "", basicUser: "" }));
      setSummary("Connector saved. The token was cleared from the form."); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save connector."); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true); setError(""); setSummary("");
    try { const response = await fetch(`/api/connectors?id=${encodeURIComponent(id)}`, { method: "DELETE" }); const body = await response.json().catch(() => ({})) as { error?: string }; if (!response.ok) throw new Error(storageError(response.status, body.error)); setConfirmRemove(null); if (scan?.id === id) setScan(null); setSummary("Connector removed."); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not remove connector."); }
    finally { setBusy(false); }
  }
  async function runScan(id: string, apply: boolean | "all" = false) {
    setScanning(id); setError(""); setSummary("");
    try {
      const response = await fetch("/api/connectors/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: apply ? JSON.stringify(apply === "all" ? { id, apply: true, selectAll: true } : { id, apply: true, select: selected }) : JSON.stringify({ id, apply: false }) });
      const body = await response.json().catch(() => ({})) as Scan & { error?: string };
      if (!response.ok) throw new Error(body.error || `Scan failed (${response.status}).`);
      setScan({ id, result: body });
      if (body.discovery) setSelected(defaultConnectorSelection(body.discovery.projects));
      if (apply && body.applied) {
        const a = body.applied; setSummary(`Registered ${a.created} created and ${a.updated} updated projects; ${a.placements} placements; ${a.unresolvedHosts?.length ?? 0} unresolved hosts (${a.unresolvedHosts?.join(", ") || "none"}); links: ${a.links?.gitops ?? 0} GitOps, ${a.links?.inferred ?? 0} inferred, ${a.links?.suggested ?? 0} suggested.${a.projects?.length ? ` Projects: ${a.projects.join(", ")}.` : ""}`);
        await Promise.all([refresh(), onRegistered()]);
      } else if (apply && body.usageRecorded !== undefined) {
        setSummary(`Recorded measured usage for ${body.usageRecorded} matching project placement${body.usageRecorded === 1 ? "" : "s"}.`); await Promise.all([refresh(), onRegistered()]);
      } else setSummary("Dry run complete. Review the results below.");
    } catch (e) { setError(e instanceof Error ? e.message : "Scan failed."); }
    finally { setScanning(null); }
  }
  function toggle(slug: string) { setSelected(current => current.includes(slug) ? current.filter(value => value !== slug) : [...current, slug]); }
  return <details className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
    <summary className="cursor-pointer font-semibold text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">Connect a cluster, Docker host or metrics source</summary>
    <div className="mt-4 space-y-5">
      <section className="space-y-3"><h3 className="text-sm font-semibold text-white">Existing connectors</h3>{connectors.length ? <ul className="grid min-w-0 gap-3 sm:grid-cols-2">{connectors.map(connector => <li key={connector.id} className="min-w-0 space-y-2 rounded-lg border border-zinc-800 p-3"><div className="flex flex-wrap items-center gap-2"><strong className="break-words text-sm text-zinc-100">{connector.label}</strong><span className={chip}>{connectorKindLabel(connector.kind)}</span></div><p className="break-words text-xs text-zinc-300">Host: {connector.hostName}</p><p className="break-all text-xs text-zinc-400">{connector.url}</p><p className="text-xs text-zinc-400">Last scan: {connectorLastScanLabel(connector.lastScanAt)} · Status: {connector.lastStatus ?? "never scanned"}</p><div className="flex flex-wrap gap-2"><button type="button" disabled={busy || scanning !== null} onClick={() => void runScan(connector.id)} className={button}>Scan (dry run)</button><button type="button" disabled={busy || scanning !== null} onClick={() => void runScan(connector.id, "all")} className={`${button} border-emerald-800 bg-emerald-500/10 text-emerald-200`}>{scanning === connector.id ? "Scanning…" : "Scan and register everything"}</button>{confirmRemove === connector.id ? <><span className="self-center text-xs text-amber-200">Remove {connector.label}?</span><button type="button" disabled={busy} onClick={() => void remove(connector.id)} className={`${button} border-rose-900 text-rose-200`}>Confirm remove</button><button type="button" disabled={busy} onClick={() => setConfirmRemove(null)} className={button}>Cancel</button></> : <button type="button" disabled={busy} onClick={() => setConfirmRemove(connector.id)} className={button}>Remove</button>}</div><p className="text-xs leading-relaxed text-zinc-500">Registers everything found, including platform pieces. You can reclassify any project afterwards.</p><CollectionDiagnostics items={connectorDiagnostics(connector.lastStatus, connector.lastScanAt)} /><ConnectorSchedule id={connector.id} kind={connector.kind} scanIntervalMinutes={connector.scanIntervalMinutes} scanRequested={connector.scanRequested} hasRescanKey={connector.hasRescanKey} unregistered={connector.lastSummary?.unregistered ?? []} onChanged={refresh} /></li>)}</ul> : <p className="text-xs text-zinc-500">No connectors registered.</p>}</section>
      <section className="space-y-3 rounded-lg border border-zinc-800 p-3"><h3 className="text-sm font-semibold text-white">Find hosts on Tailscale</h3>
        <p className="text-xs leading-relaxed text-zinc-400">Paste one or more Tailscale addresses (100.x.y.z), or the output of <code>tailscale status</code>. FleetHub checks only four standard ports (Kubernetes 6443, Docker proxy 2375 and 2376, Prometheus 9090) on Tailscale addresses, sends nothing to them, and shows how each host can be connected. Gateways already known to FleetHub are included.</p>
        <textarea rows={3} value={peerText} onChange={e => setPeerText(e.target.value)} className={field} placeholder={"100.101.50.7 atlas\n100.101.0.4"} aria-label="Tailscale addresses" />
        <button type="button" disabled={finding || busy} onClick={() => void findHosts()} className={button}>{finding ? "Checking…" : "Find ways to connect"}</button>
        {found && (found.length ? <ul className="grid min-w-0 gap-3 sm:grid-cols-2">{found.map(host => <li key={host.ip} className="min-w-0 space-y-2 rounded-lg border border-zinc-800 p-3"><div className="flex flex-wrap items-center gap-2"><strong className="text-sm"><HostLabel name={host.name ?? host.ip} href={host.name ? `/hosts/${encodeURIComponent(hostKey(host.name))}` : undefined} addresses={[{ address: host.ip, kind: "tailscale", source: "probe" }]} /></strong></div>
          {host.suggestions.length ? <div className="space-y-2">{host.suggestions.map(suggestion => <div key={suggestion.port} className="space-y-1"><p className="text-xs text-emerald-200">Reachable: {suggestion.label} ({suggestion.port})</p><p className="text-[11px] leading-relaxed text-zinc-400">{suggestion.note}</p><button type="button" onClick={() => useSuggestion(host, suggestion)} className={`${button} border-emerald-800 bg-emerald-500/10 text-emerald-200`}>Fill the form</button><button type="button" disabled={busy} onClick={() => setProbeSelection({ ip: host.ip, port: suggestion.port })} className={`${button} ml-2`}>Connect here</button>{probeSelection?.ip === host.ip && probeSelection.port === suggestion.port && <ProbeConnectorForm key={`${host.ip}:${suggestion.port}`} host={host} suggestion={suggestion} hosts={knownHosts} onCancel={() => setProbeSelection(null)} onSaved={async () => { setProbeSelection(null); setSummary("Connector saved from the probe card. Credentials cleared."); await refresh(); }} />}</div>)}</div> : <p className="text-xs text-amber-200">No live endpoint answered on the standard ports. This is not an error; use one of the other ways.</p>}
          <details><summary className="cursor-pointer text-xs text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">Other ways to connect this host</summary><ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-zinc-400">{host.otherWays.map(way => <li key={way}>{way}</li>)}</ul></details></li>)}</ul> : <p className="text-xs text-zinc-500">No Tailscale addresses to check.</p>)}
      </section>
      <datalist id="connector-known-hosts">{knownHosts.map(host => <option key={host.id} value={host.name} />)}</datalist>
      <form onSubmit={add} className="grid min-w-0 gap-3 rounded-lg border border-zinc-800 p-3 sm:grid-cols-2"><h3 className="text-sm font-semibold text-white sm:col-span-2">Add connector</h3>
        <label className="min-w-0 text-xs text-zinc-300">Kind<select value={kind} onChange={e => setKind(e.target.value as Kind)} className={field}><option value="kubernetes">Kubernetes</option><option value="docker">Docker</option><option value="prometheus">Prometheus</option></select></label>
        <p className="self-end text-xs leading-relaxed text-zinc-400 sm:pb-2">{help[kind]}</p>
        <label className="min-w-0 text-xs text-zinc-300">Label<input required maxLength={80} value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} className={field} /></label>
        <label className="min-w-0 text-xs text-zinc-300">Host name<input required maxLength={80} list="connector-known-hosts" value={form.hostName} onChange={e => setForm({ ...form, hostName: e.target.value })} className={field} placeholder="The name this machine or cluster has in FleetHub, e.g. borealis" /><span className="mt-1 block text-[11px] text-zinc-500">The name this machine or cluster has in FleetHub, e.g. borealis.</span></label>
        <label className="min-w-0 text-xs text-zinc-300 sm:col-span-2">URL<input required type="url" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} className={field} placeholder="https://…" /></label>
        {kind === "prometheus" && <label className="min-w-0 text-xs text-zinc-300">Basic-auth user (optional)<input autoComplete="off" value={form.basicUser} onChange={e => setForm({ ...form, basicUser: e.target.value })} className={field} /></label>}
        <label className="min-w-0 text-xs text-zinc-300">{kind === "prometheus" ? "Token / password (optional)" : kind === "docker" ? "Proxy token (if required)" : "Read-only token"}<input required={kind === "kubernetes"} type="password" autoComplete="off" value={form.token} onChange={e => setForm({ ...form, token: e.target.value })} className={field} /></label>
        {(kind === "kubernetes" || kind === "prometheus") && <label className="min-w-0 text-xs text-zinc-300 sm:col-span-2">CA certificate PEM (optional)<textarea rows={4} value={form.caPem} onChange={e => setForm({ ...form, caPem: e.target.value })} className={field} /></label>}
        {kind === "docker" && <label className="flex items-start gap-2 text-xs text-zinc-300 sm:col-span-2"><input type="checkbox" checked={form.allowHttp} onChange={e => setForm({ ...form, allowHttp: e.target.checked })} className="mt-0.5 size-4 accent-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" />Allow HTTP for a private read-only socket proxy. Never point this at a raw Docker socket.</label>}
        {kind === "prometheus" && <label className="flex items-start gap-2 text-xs text-zinc-300 sm:col-span-2"><input type="checkbox" checked={form.allowHttp} onChange={e => setForm({ ...form, allowHttp: e.target.checked })} className="mt-0.5 size-4 accent-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" />Allow HTTP only for a trusted private metrics endpoint.</label>}
        {form.allowHttp && <p className="text-xs text-amber-200 sm:col-span-2">Warning: HTTP does not encrypt traffic. Use it only on a trusted private network.</p>}
        <button type="submit" disabled={busy} className="justify-self-start rounded-lg border border-emerald-800 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50">{busy ? "Saving…" : "Save connector"}</button>
      </form>
      {scan && <section className="min-w-0 space-y-4 border-t border-zinc-800 pt-4"><h3 className="text-sm font-semibold text-white">Scan results · {connectors.find(item => item.id === scan.id)?.label ?? scan.id}</h3>{scan.result.discovery && <DiscoveryReview discovery={scan.result.discovery} selected={selected} onToggle={toggle} busy={scanning !== null} actionLabel="Register" onAction={() => void runScan(scan.id, true)} />}{scan.result.usage && <div className="space-y-4"><div><h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Whole-host capacity</h4><div className="mt-2 overflow-x-auto"><table className="w-full min-w-[560px] border-collapse text-left text-xs"><thead><tr className="border-b border-zinc-800 text-zinc-400"><th className="p-2">Server</th><th className="p-2">CPU cores</th><th className="p-2">Busy cores</th><th className="p-2">Memory used / total</th></tr></thead><tbody>{scan.result.usage.hosts.map(row => <tr key={row.instance} className="border-b border-zinc-900"><td className="p-2 text-zinc-200"><HostLabel name={measuredHostName(row)} href={`/hosts/${encodeURIComponent(hostKey(measuredHostName(row)))}`} addresses={(addressKind(row.instance.replace(/:\d+$/, "")) ? [{ address: row.instance.replace(/:\d+$/, ""), kind: addressKind(row.instance.replace(/:\d+$/, ""))!, source: "prometheus" }] : [])} /></td><td className="p-2 text-zinc-300">{formatCpu(row.cpuCores)}</td><td className="p-2 text-zinc-300">{formatCpu(row.cpuBusyCores)}</td><td className="p-2 text-zinc-300">{formatMi(row.memUsedMi)} / {formatMi(row.memTotalMi)}</td></tr>)}</tbody></table></div>{scan.result.usage.hosts.length === 0 && <p className="mt-2 text-xs text-zinc-500">No node_exporter host metrics returned.</p>}</div>{([["Usage per namespace", scan.result.usage.namespaces], ["Usage per Compose project", scan.result.usage.composeProjects]] as [string, ScopeUsage[]][]).map(([title, rows]) => <div key={title}><h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</h4>{rows.length ? <ul className="mt-2 grid gap-2 sm:grid-cols-2">{rows.map(row => <li key={`${row.instance}-${row.scope}`} className="min-w-0 break-words rounded-lg border border-zinc-800 p-2 text-xs text-zinc-300">{row.scope} · {row.instance || "instance missing; not attributed"}: {formatCpu(row.cpuCores)}, {formatMi(row.memMi)}</li>)}</ul> : <p className="mt-1 text-xs text-zinc-500">No usage rows returned.</p>}</div>)}<p className="text-xs leading-relaxed text-zinc-400">Usage is recorded against projects only when both the machine and namespace or Compose project match one registered project. Shared or unresolved scopes are omitted.</p><button type="button" disabled={scanning !== null} onClick={() => void runScan(scan.id, true)} className={`${button} bg-emerald-500/10 text-emerald-200`}>{scanning === scan.id ? "Recording…" : "Record measured usage"}</button></div>}</section>}
      <div aria-live="polite" className="space-y-1 text-sm">{error && <p role="alert" className="break-words text-rose-200">{error}</p>}{summary && <p role="status" className="break-words text-emerald-200">{summary}</p>}</div>
    </div>
  </details>;
}
