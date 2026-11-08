"use client";

import { useCallback, useEffect, useState } from "react";
import { CollectionDiagnostics } from "./CollectionDiagnostics";
import { accountDiagnostics } from "@/lib/connectors/diagnostics";
import { AccountCredentialControls, type RotationInfo, type RotatorInfo } from "./AccountCredentialControls";
import { z } from "zod";
import { manualResourceInput, resourceCategorySchema, supportedInventoryProviders, type FleetAccount, type FleetSnapshot } from "@/lib/inventory/model";

interface Props {
  accounts: FleetAccount[];
  onConnectCredentials?: (account: FleetAccount) => void;
  worker: FleetSnapshot["worker"];
  onReload: () => Promise<void>;
  onSelectAccount: (id: string | null) => void;
  selectedAccountId: string | null;
}

const responseSchema = z.object({ error: z.string().optional(), message: z.string().optional() }).passthrough();
const categories = ["compute", "storage", "database", "serverless", "llm", "network"] as const;
function time(value: string | null) { return value ? new Date(value).toLocaleString() : "Never"; }

export function InventoryAccountsPanel({ accounts, worker, onReload, onSelectAccount, selectedAccountId, onConnectCredentials }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manualId, setManualId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nativeId, setNativeId] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("compute");
  const [region, setRegion] = useState("");
  const [rotation, setRotation] = useState<{ accounts: RotationInfo[]; rotators: RotatorInfo[] }>({ accounts: [], rotators: [] });
  const loadRotation = useCallback(async () => {
    try {
      const response = await fetch("/api/rotation", { cache: "no-store" });
      if (!response.ok) return;
      const body: unknown = await response.json();
      const parsed = z.object({ accounts: z.array(z.custom<RotationInfo>()), rotators: z.array(z.custom<RotatorInfo>()) }).safeParse(body);
      if (parsed.success) setRotation(parsed.data);
    } catch { /* Rotation status is optional; the rest of the panel keeps working. */ }
  }, []);
  useEffect(() => { void loadRotation(); }, [loadRotation, accounts.length]);

  async function submit(path: string, body: unknown, accountId: string, success: string): Promise<boolean> {
    setBusyId(accountId); setError(null); setNotice(null);
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const parsed = responseSchema.safeParse(await response.json());
      if (!response.ok) throw new Error(parsed.success ? parsed.data.error ?? parsed.data.message ?? "Request failed." : "Request failed.");
      setNotice(success);
      await onReload();
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed."); return false; }
    finally { setBusyId(null); }
  }

  async function register(event: React.FormEvent) {
    event.preventDefault();
    if (!manualId) return;
    const parsed = manualResourceInput.safeParse({ accountId: manualId, nativeId, name, category, ...(region.trim() ? { region } : {}) });
    if (!parsed.success) { setError("Enter an account, resource ID, name, and valid category."); return; }
    if (await submit("/api/resources", parsed.data, manualId, "Resource registered as unverified inventory.")) {
      setNativeId(""); setName(""); setRegion("");
    }
  }

  return <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-base font-semibold text-white">Accounts and collection</h2><p className="text-xs text-zinc-400">Inventory is collected by the server. Manual entries are unverified.</p></div><span className={worker.status === "online" ? "text-xs text-emerald-300" : "text-xs text-amber-300"}>Worker {worker.status}{worker.lastSeenAt ? ` · last seen ${time(worker.lastSeenAt)}` : ""}</span></div>
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}{notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
    {accounts.length === 0 ? <p className="text-sm text-zinc-400">No accounts registered yet.</p> : <div className="grid gap-3 md:grid-cols-2">{accounts.map(account => {
      const supported = supportedInventoryProviders.some(provider => provider === account.kind);
      const canCollect = supported && !account.archived && !["needs_credentials", "unsupported", "queued", "running"].includes(account.collection.state);
      return <article key={account.id} className={`min-w-0 break-words rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 space-y-3 ${account.archived ? "opacity-60" : ""}`}>
        <div className="flex justify-between gap-2"><div className="min-w-0"><h3 className="font-medium text-white">{account.label}</h3><p className="text-xs text-zinc-400">{account.kind} · {account.ownerEmail}{account.plan && account.plan !== "unknown" ? ` · ${account.plan} plan` : ""}{account.isProtected ? " · protected" : ""}</p></div><span className="shrink-0 text-xs text-zinc-300">{account.archived ? "archived" : account.collection.state.replaceAll("_", " ")}</span></div>
        <p className="text-xs text-zinc-400">{account.collection.resourceCount} collected resources · Last success {time(account.collection.lastSuccessAt)} · Last attempt {time(account.collection.lastAttemptAt)}</p>
        {account.collection.message && <p className="text-xs text-amber-300">{account.collection.message}</p>}
        {account.collection.errorCode && <p className="text-xs text-rose-300">{account.collection.errorCode.replaceAll("_", " ")}</p>}
        <CollectionDiagnostics items={accountDiagnostics(account.collection)} />
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => onSelectAccount(selectedAccountId === account.id ? null : account.id)} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-200">{selectedAccountId === account.id ? "Show all resources" : "View resources"}</button>
        {supported && account.collection.state === "needs_credentials" && onConnectCredentials && <button type="button" onClick={() => onConnectCredentials(account)} className="rounded border border-cyan-700 px-2 py-1 text-xs text-cyan-300">Connect credentials</button>}
        {canCollect && <button type="button" disabled={busyId !== null} onClick={() => submit("/api/inventory/refresh", { accountId: account.id }, account.id, "Collection queued. The worker will update this account.")} className="rounded border border-cyan-700 px-2 py-1 text-xs text-cyan-300 disabled:opacity-50">{busyId === account.id ? "Queuing…" : "Collect inventory"}</button>}
        <button type="button" onClick={() => { setManualId(manualId === account.id ? null : account.id); setError(null); }} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-200">{manualId === account.id ? "Close form" : "Register resource"}</button></div>
        {supported && account.collection.state !== "needs_credentials" && <AccountCredentialControls key={`${account.id}:${account.credentialExpiresAt}:${account.ownerEmail}:${account.archived}:${account.plan}:${account.label}`} label={account.label} ownerEmail={account.ownerEmail} expiresAt={account.credentialExpiresAt} archived={account.archived} plan={account.plan} accountId={account.id} kind={account.kind} info={rotation.accounts.find(item => item.accountId === account.id)} rotator={rotation.rotators.find(item => item.providerId === account.kind)} onChanged={async () => { await loadRotation(); await onReload(); }} />}
        {manualId === account.id && <form onSubmit={register} className="grid gap-2 text-xs"><p className="text-zinc-400">Add inventory only. This does not access the resource.</p><input aria-label="Native resource ID" required value={nativeId} onChange={e => setNativeId(e.target.value)} placeholder="Provider resource ID" className="rounded bg-zinc-950 p-2"/><input aria-label="Resource name" required value={name} onChange={e => setName(e.target.value)} placeholder="Resource name" className="rounded bg-zinc-950 p-2"/><select aria-label="Category" value={category} onChange={e => { const parsed = resourceCategorySchema.safeParse(e.target.value); if (parsed.success) setCategory(parsed.data); }} className="rounded bg-zinc-950 p-2">{categories.map(item => <option key={item} value={item}>{item}</option>)}</select><input aria-label="Region" value={region} onChange={e => setRegion(e.target.value)} placeholder="Region (optional)" className="rounded bg-zinc-950 p-2"/><button disabled={busyId !== null} className="rounded bg-cyan-500 px-3 py-2 font-medium text-zinc-950 disabled:opacity-50">Save manual resource</button></form>}
      </article>;
    })}</div>}
  </section>;
}
