"use client";

import { z } from "zod";
import { useState, type FormEvent, type ReactNode } from "react";
import { appAccountSnapshot, type AppAccountSnapshot } from "@/lib/app-accounts/model";

const field = "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-cyan-400";
const button = "rounded-lg border border-cyan-700 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-950 disabled:opacity-50";
function Select({ name, label, options }: { name: string; label: string; options: { id: string; label: string }[] }) {
  return <label className="text-sm text-zinc-300">{label}<select name={name} required className={field} defaultValue=""><option value="" disabled>Choose {label.toLowerCase()}</option>{options.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>;
}
function Input({ name, label, maxLength = 120 }: { name: string; label: string; maxLength?: number }) {
  return <label className="text-sm text-zinc-300">{label}<input name={name} required maxLength={maxLength} className={field} /></label>;
}
export default function AppAccountsPage() {
  const [data, setData] = useState<AppAccountSnapshot | null>(null);
  const [storedRefs, setStoredRefs] = useState<{ id: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function load() {
    const response = await fetch("/api/app-accounts", { cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Sign in to FleetHub as an operator to view app accounts." : "App accounts unavailable. Try again.");
    setData(appAccountSnapshot.parse(await response.json()));
  }
  async function refresh() {
    setBusy(true); setMessage("");
    try { await load(); } catch (cause) { setData(null); setMessage(cause instanceof Error ? cause.message : "App accounts unavailable."); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>, action: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const body: Record<string, unknown> = Object.fromEntries(values);
    if (action === "credential") {
      body.scopes = String(values.get("scopes") ?? "").split(",").map(value => value.trim()).filter(Boolean);
      const expires = String(values.get("expiresAt") ?? "");
      body.expiresAt = expires ? new Date(`${expires}T00:00:00.000Z`).toISOString() : null;
    }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/app-accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, action }) });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Sign in as an operator before saving." : "Could not save. Check the fields and related records, then try again.");
      form.reset();
      // A failed refresh must not suggest repeating a write that already succeeded.
      try { await load(); setMessage(action === "unlink" ? "Consumer link removed locally. Upstream credentials were not revoked." : "Saved manual metadata. Upstream validity has not been checked."); }
      catch { setData(null); setMessage("Saved, but the ledger could not refresh. Reload the ledger before making another change."); }
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not save."); }
    finally { setBusy(false); }
  }
  async function storeKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/credentials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: values.get("label"), value: values.get("value") }) });
      // Clear the value whatever happens; it must not linger in the page.
      form.reset();
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Sign in as an operator before storing a key." : response.status === 409 ? "Verify a secret store in setup first." : "Could not store the key. Try again.");
      const { id } = z.object({ id: z.string().min(1) }).parse(await response.json());
      setStoredRefs(previous => [...previous, { id, label: String(values.get("label") ?? "Stored key") }]);
      try { await load(); setMessage("Key stored encrypted. Choose it as the secret reference in step 3."); }
      catch { setData(null); setMessage("Key stored, but the ledger could not refresh. Reload before linking it."); }
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not store the key."); }
    finally { setBusy(false); }
  }
  function section(title: string, action: string, children: ReactNode) {
    return <form onSubmit={event => void save(event, action)}><fieldset disabled={busy} className="grid gap-4 rounded-xl border border-zinc-800 p-5 sm:grid-cols-2"><legend className="px-2 text-base font-medium">{title}</legend>{children}<div className="sm:col-span-2"><button className={button}>Save {action === "consumer" ? "consumer link" : action}</button></div></fieldset></form>;
  }
  const accountLabel = (id: string) => data?.accounts.find(item => item.id === id)?.label ?? "Account outside this view";
  const workspaceLabel = (id: string) => {
    const workspace = data?.workspaces.find(item => item.id === id);
    return workspace ? `${accountLabel(workspace.accountId)} / ${workspace.label}` : "Workspace outside this view";
  };
  return <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 text-zinc-100 sm:px-8">
    <header className="max-w-3xl space-y-3"><a href="/?tab=identities" className="text-sm text-cyan-300 underline underline-offset-4">Back to FleetHub</a>
      <p className="pt-4 text-xs uppercase tracking-widest text-zinc-500">Manual ledger / supporting services</p><h1 className="text-3xl font-semibold tracking-tight">App accounts &amp; consumers</h1>
      <p className="text-sm leading-6 text-zinc-400">Record who owns an account, who issued a credential, and which projects use it. These are manual relationships. They add no cloud capacity and trigger no service calls.</p>
      <p className="text-sm leading-6 text-zinc-400">Enter labels and non-secret metadata only. Never paste API keys here. Create people and contacts in FleetHub first. Credential links use encrypted-store references; store a new key below if it is not in FleetHub yet.</p>
      <button onClick={() => void refresh()} disabled={busy} className={button}>{busy ? "Working…" : "Load / refresh ledger"}</button>
    </header>
    <p role="status" aria-live="polite" className="text-sm text-cyan-200">{message}</p>
    {data && <>
      {data.limited && <p className="text-amber-300">This view is limited to 1,000 records per list. Some relationships may be outside this view.</p>}
      <section aria-label="Saved accounts" className="space-y-4">
        {!data.accounts.length && <p className="text-zinc-400">No app accounts recorded yet. Start with an account below.</p>}
        {data.accounts.map(account => <article key={account.id} className="rounded-xl border border-zinc-800 p-5">
          <h2 className="text-lg font-medium">{account.label} <span className="text-sm text-zinc-400">/ {account.service}</span></h2>
          <p className="mt-2 break-words text-sm text-zinc-400">Owner: {account.owner} / {account.contact}</p>
          {data.workspaces.filter(workspace => workspace.accountId === account.id).map(workspace => <div key={workspace.id} className="mt-4 border-l border-zinc-700 pl-4"><h3 className="font-medium">{workspace.label}</h3>
            {data.credentials.filter(credential => credential.workspaceId === workspace.id).map(credential => <div key={credential.id} className="mt-3 space-y-2 break-words text-sm text-zinc-400">
              <p className="text-zinc-200">{credential.label}</p><p>Issuer: {credential.issuer}. Purpose: {credential.purpose}. Environment: {credential.environment}.</p>
              <p>Scopes: {credential.scopes.join(", ") || "Unknown"}. Validity reported manually: {credential.validity}. Expiry: {credential.expiresAt ?? "Unknown"}.</p>
              <p>Reference: {data.secretRefs.find(ref => ref.id === credential.secretRefId)?.label ?? "Outside this view"}</p>
              <ul className="space-y-2">{data.consumers.filter(consumer => consumer.credentialId === credential.id).map(consumer => <li key={consumer.projectId} className="flex flex-wrap items-center gap-3">Consumer: {data.projects.find(project => project.id === consumer.projectId)?.label ?? "Archived project or outside this view"}
                <form onSubmit={event => void save(event, "unlink")}><input type="hidden" name="credentialId" value={credential.id} /><input type="hidden" name="projectId" value={consumer.projectId} /><button disabled={busy} className="text-cyan-300 underline">Remove local link</button></form>
              </li>)}</ul>
            </div>)}
          </div>)}
        </article>)}
      </section>
      {section("1. Account & owner", "account", <><Input name="label" label="Account label" /><Input name="service" label="Service name" /><Select name="ownerContactId" label="Owner contact" options={data.contacts} /></>)}
      {section("2. Workspace", "workspace", <><Select name="accountId" label="Account" options={data.accounts} /><Input name="label" label="Workspace label" /></>)}
      <form onSubmit={event => void storeKey(event)} autoComplete="off"><fieldset disabled={busy} className="grid gap-4 rounded-xl border border-zinc-800 p-5 sm:grid-cols-2"><legend className="px-2 text-base font-medium">Store a new key (optional)</legend>
        <p className="text-sm leading-6 text-zinc-400 sm:col-span-2">The key goes to the verified secret store and is never shown again. Removing FleetHub&apos;s copy later does not revoke it at the issuer.</p>
        <Input name="label" label="Reference label" /><label className="text-sm text-zinc-300">Key value<input name="value" type="password" required maxLength={8192} autoComplete="new-password" spellCheck={false} className={field} /></label>
        <div className="sm:col-span-2"><button className={button}>Store key</button></div>
      </fieldset></form>
      {section("3. Credential reference", "credential", <>
        <Select name="workspaceId" label="Workspace" options={data.workspaces.map(item => ({ id: item.id, label: workspaceLabel(item.id) }))} /><Select name="secretRefId" label="Existing secret reference" options={[...data.secretRefs, ...storedRefs.filter(ref => !data.secretRefs.some(item => item.id === ref.id))]} />
        <Input name="label" label="Credential label" /><Input name="issuer" label="Credential issuer" /><Input name="purpose" label="Purpose" maxLength={300} /><Input name="environment" label="Environment" />
        <label className="text-sm text-zinc-300">Granted scopes, comma separated. Blank means unknown.<input name="scopes" maxLength={4800} className={field} /></label>
        <label className="text-sm text-zinc-300">Expiry date, UTC. Blank means unknown.<input name="expiresAt" type="date" className={field} /></label>
        <label className="text-sm text-zinc-300">Reported validity<select name="validity" className={field}><option value="unknown">Unknown</option><option value="active">Reported active</option><option value="revoked">Reported revoked</option></select></label>
      </>)}
      {section("4. Consuming project / app", "consumer", <><Select name="credentialId" label="Credential" options={data.credentials.map(item => ({ id: item.id, label: `${workspaceLabel(item.workspaceId)} / ${item.label}` }))} /><Select name="projectId" label="Project" options={data.projects} /></>)}
    </>}
  </main>;
}
