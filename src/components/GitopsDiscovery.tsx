"use client";
import { useState } from "react";
import type { Discovery } from "@/lib/gitops/discover";
import { filterGitopsFiles, relativeManifestPath, type BrowserManifestFile, type FileSkip } from "@/lib/gitops/browser";
import { DiscoveryReview } from "@/components/DiscoveryReview";
import { defaultConnectorSelection } from "@/lib/connectors/view";

const button = "rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-50";
type Applied = { created: number; updated: number; placements: number; unresolvedHosts: string[]; links: { gitops: number; inferred: number; suggested: number }; projects?: string[]; applied?: boolean };
function messageFor(status: number, detail?: string) {
  if (status === 400) return detail || "The selected files could not be used. Check the manifests and try again.";
  if (status === 401) return "Sign in again to discover and register projects.";
  if (status === 403) return "Your account is not allowed to register projects from GitOps.";
  if (status === 413) return "The selected manifests are too large to send. Choose fewer or smaller YAML files.";
  if (status === 503) return "Project storage is unavailable. Try again when FleetHub is ready.";
  return detail || `Discovery failed (${status}).`;
}
export function GitopsDiscovery({ onRegistered }: { onRegistered: () => Promise<void> | void }) {
  const [manifests, setManifests] = useState<BrowserManifestFile[]>([]), [skipped, setSkipped] = useState<FileSkip[]>([]);
  const [discovery, setDiscovery] = useState<Discovery | null>(null), [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [summary, setSummary] = useState("");
  async function readSelection(list: FileList | null) {
    setDiscovery(null); setSummary(""); setError("");
    const selection = filterGitopsFiles(list ?? []);
    setSkipped(selection.skipped);
    if (!selection.files.length) { setManifests([]); setError("No safe YAML manifest files were found."); return; }
    setBusy(true);
    try {
      const files = await Promise.all(selection.files.map(async file => ({ path: relativeManifestPath(file), content: await file.text() })));
      setManifests(files);
      await runDiscovery(files, false);
    } catch { setError("The selected files could not be read in your browser."); }
    finally { setBusy(false); }
  }
  async function runDiscovery(files = manifests, apply: boolean | "all" = false) {
    setBusy(true); setError(""); setSummary("");
    try {
      const response = await fetch("/api/gitops/discover", { method: "POST", headers: { "Content-Type": "application/json" }, body: apply ? JSON.stringify(apply === "all" ? { files, apply: true, selectAll: true, sourceRef: "gitops folder upload" } : { files, apply: true, select: selected, sourceRef: "gitops folder upload" }) : JSON.stringify({ files, apply: false }) });
      const body = await response.json().catch(() => ({})) as Discovery & Applied & { error?: string };
      if (!response.ok) throw new Error(messageFor(response.status, body.error));
      if (!apply) {
        setDiscovery(body); setSelected(defaultConnectorSelection(body.projects));
      } else {
        const text = `Registered ${body.created} created and ${body.updated} updated projects; ${body.placements} placements; ${body.unresolvedHosts?.length ?? 0} unresolved hosts (${body.unresolvedHosts?.join(", ") || "none"}); links: ${body.links?.gitops ?? 0} GitOps, ${body.links?.inferred ?? 0} inferred, ${body.links?.suggested ?? 0} suggested.${body.projects?.length ? ` Projects: ${body.projects.join(", ")}.` : ""}`;
        setSummary(text); await onRegistered();
      }
    } catch (e) { setError(e instanceof Error ? e.message : "GitOps discovery failed."); }
    finally { setBusy(false); }
  }
  function toggle(slug: string) { setSelected(current => current.includes(slug) ? current.filter(value => value !== slug) : [...current, slug]); }
  return <details className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
    <summary className="cursor-pointer font-semibold text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">Discover projects from your GitOps repo</summary>
    <div className="mt-4 space-y-5">
      <section className="space-y-2"><h3 className="text-sm font-semibold text-white">Step 1 · Choose a local checkout folder</h3><label className="block text-xs text-zinc-300">GitOps checkout folder<input type="file" multiple {...({ webkitdirectory: "" } as Record<string, string>)} onChange={event => void readSelection(event.currentTarget.files)} className="mt-2 block w-full text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border file:border-zinc-700 file:bg-zinc-950 file:px-3 file:py-2 file:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" /></label><p className="text-xs text-zinc-400">Files are read in your browser; secret-looking files are never read; only manifests are sent to this FleetHub server. YAML files up to 200 KB each, at most 600.</p>{manifests.length > 0 && <p className="text-xs text-zinc-300">Read {manifests.length} manifest files.</p>}</section>
      {discovery && <div className="space-y-4"><p className="text-sm font-semibold text-white">Step 2 · Review discovery</p><DiscoveryReview discovery={discovery} selected={selected} onToggle={toggle} busy={busy} onAction={() => void runDiscovery(manifests, true)} /><button type="button" disabled={busy || discovery.projects.length === 0} onClick={() => void runDiscovery(manifests, "all")} className={`${button} bg-emerald-500/10 text-emerald-200`}>{busy ? "Registering…" : "Register everything found"}</button></div>}
      {skipped.length > 0 && <details className="rounded-lg border border-zinc-800 p-3"><summary className="cursor-pointer text-sm text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">Skipped files ({skipped.length})</summary><ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs text-zinc-400">{skipped.map((item, index) => <li key={`${item.path}-${index}`} className="break-all">{item.path}: {item.reason}</li>)}</ul></details>}
      <div aria-live="polite" className="space-y-1 text-sm">{error && <p role="alert" className="break-words text-rose-200">{error}</p>}{summary && <p role="status" className="break-words text-emerald-200">{summary}</p>}</div>
    </div>
  </details>;
}
