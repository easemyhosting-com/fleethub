"use client";

import { useState } from "react";
import { credentialFields } from "@/lib/rotation/fields";
import { IdentityPicker, resolveIdentity, useIdentities } from "./IdentityPicker";
import { choiceEmail, choiceIsValid, suggestIdentity, type IdentityChoice } from "@/lib/identity/picker";

export type RotationInfo = {
  accountId: string; kind: string; rotatorConfigured: boolean; scheduleDays: number | null;
  nextRotationAt: string | null; lastRotatedAt: string | null; lastStatus: string | null; lastErrorCode: string | null;
};
export type RotatorInfo = { providerId: string; label: string; rotatorHint: string };

interface Props { accountId: string; kind: string; info?: RotationInfo; rotator?: RotatorInfo; expiresAt?: string | null; archived?: boolean; plan?: string; ownerEmail?: string; label?: string; onChanged: () => Promise<void> }

const when = (value: string | null) => (value ? new Date(value).toLocaleString() : "Never");

export function AccountCredentialControls({ accountId, kind, info, rotator, expiresAt, archived, plan, ownerEmail, label, onChanged }: Props) {
  const [name, setName] = useState(label ?? "");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const identities = useIdentities();
  const [choice, setChoice] = useState<IdentityChoice | null>(null);
  const suggested = identities && ownerEmail ? suggestIdentity(identities, ownerEmail) : null;
  async function saveOwner() {
    const picked = choice ?? suggested;
    if (!picked) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const identityId = await resolveIdentity(picked);
      const email = picked.mode === "existing" ? choiceEmail(identities ?? [], picked) : null;
      await send({ accountId, identityId, ...(email ? { email } : {}) }, undefined, "/api/accounts/owner");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed."); setBusy(false); }
  }
  const [expiry, setExpiry] = useState(expiresAt ? expiresAt.slice(0, 10) : "");
  const [open, setOpen] = useState<"replace" | "auto" | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [rotatorSecret, setRotatorSecret] = useState("");
  const [days, setDays] = useState(info?.scheduleDays ? String(info.scheduleDays) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fields = credentialFields[kind] ?? [];

  async function send(body: unknown, after?: () => void, path = "/api/rotation") {
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const parsed: unknown = await response.json();
      const text = (key: string) => (typeof parsed === "object" && parsed !== null && key in parsed && typeof (parsed as Record<string, unknown>)[key] === "string" ? String((parsed as Record<string, unknown>)[key]) : null);
      if (!response.ok) throw new Error(text("error") ?? "Request failed.");
      setNotice(text("message") ?? "Done."); after?.(); await onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed."); }
    finally { setBusy(false); }
  }

  return <div className="space-y-2 border-t border-zinc-800 pt-3 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-zinc-400">Credentials</span>
      <button type="button" disabled={busy} onClick={() => setOpen(open === "replace" ? null : "replace")} className="rounded border border-zinc-700 px-2 py-1 text-zinc-200 disabled:opacity-50">Replace</button>
      {rotator && <>
        <button type="button" disabled={busy || !info?.rotatorConfigured} title={info?.rotatorConfigured ? "Roll the secret now" : "Set up auto-rotation first"} onClick={() => send({ action: "rotate", accountId })} className="rounded border border-cyan-700 px-2 py-1 text-cyan-300 disabled:opacity-40">{busy ? "Working…" : "Rotate now"}</button>
        <button type="button" disabled={busy} onClick={() => setOpen(open === "auto" ? null : "auto")} className="rounded border border-zinc-700 px-2 py-1 text-zinc-200 disabled:opacity-50">Auto-rotation</button>
      </>}
    </div>
    <details onToggle={event => setSettingsOpen(event.currentTarget.open)} className="text-zinc-400">
      <summary className="cursor-pointer select-none">Account settings{expiresAt ? ` · token expires ${new Date(expiresAt).toLocaleDateString()}` : ""}</summary>
      {settingsOpen && <div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`label-${accountId}`}>Label</label>
          <input id={`label-${accountId}`} disabled={busy} value={name} maxLength={200} onChange={event => setName(event.target.value)} className="w-56 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100" />
          <button type="button" disabled={busy || !name.trim() || name.trim() === label} onClick={() => void send({ accountId, label: name.trim() }, undefined, "/api/accounts/owner")} className="rounded border border-zinc-700 px-2 py-1 text-zinc-200 disabled:opacity-50">Save label</button>
          <span className="text-zinc-500">Region is part of the credential: use Replace to change it.</span>
        </div>
        <IdentityPicker label="Account owner" identities={identities} choice={choice ?? suggested} disabled={busy} onChange={setChoice} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy || !choiceIsValid(choice ?? suggested)} onClick={() => void saveOwner()} className="rounded border border-zinc-700 px-2 py-1 text-zinc-200 disabled:opacity-50">Save owner</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`plan-${accountId}`}>Plan</label>
          <select id={`plan-${accountId}`} disabled={busy} value={plan ?? "unknown"} onChange={event => void send({ accountId, plan: event.target.value }, undefined, "/api/accounts/owner")} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200">
            <option value="unknown">Unknown</option><option value="free">Free</option><option value="paid">Paid</option>
          </select>
          <span className="text-zinc-500">Free accounts show only free-tier resources.</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={() => send({ accountId, archived: !archived }, undefined, "/api/accounts/archive")} className="rounded border border-zinc-700 px-2 py-1 text-zinc-200 disabled:opacity-50">{archived ? "Restore account" : "Archive account"}</button>
          <span className="text-zinc-500">{archived ? "Scanning and alerts are off." : "Stops scanning and alerts; keeps the account and its history."}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`expiry-${accountId}`}>Token expires</label>
          <input id={`expiry-${accountId}`} type="date" value={expiry} onChange={event => setExpiry(event.target.value)} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200" />
          <button type="button" disabled={busy} onClick={() => send({ action: "expiry", accountId, expiresOn: expiry || null })} className="rounded border border-zinc-700 px-2 py-1 text-zinc-200 disabled:opacity-50">Save date</button>
          <span className="text-zinc-500">{kind === "cloudflare" ? "Read from Cloudflare automatically; set it yourself to override." : "FleetHub warns 14 days before this date."}</span>
        </div>
      </div>}
    </details>
    {info?.rotatorConfigured && <p className="text-zinc-400">{info.scheduleDays ? `Rotates every ${info.scheduleDays} days · next ${when(info.nextRotationAt)}` : "Manual rotation only"} · last rotated {when(info.lastRotatedAt)}{info.lastStatus === "failed" ? <span className="text-rose-300"> · last attempt failed ({(info.lastErrorCode ?? "error").replaceAll("_", " ")})</span> : null}</p>}
    {error && <p role="alert" className="text-rose-300">{error}</p>}{notice && <p role="status" className="text-emerald-300">{notice}</p>}
    {open === "replace" && <form className="grid gap-2" onSubmit={event => { event.preventDefault(); void send({ action: "replace", accountId, config: Object.fromEntries(fields.map(field => [field.key, (values[field.key] ?? "").trim()])) }, () => { setValues({}); setOpen(null); }); }}>
      <p className="text-zinc-400">Stored in the vault and read back before the old secret is removed. The account identifiers must match what you registered.</p>
      {fields.map(field => field.multiline
        ? <textarea key={field.key} aria-label={field.label} required rows={4} autoComplete="off" spellCheck={false} value={values[field.key] ?? ""} onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))} placeholder={field.label} className="rounded bg-zinc-950 p-2 font-mono" />
        : <input key={field.key} aria-label={field.label} required type={field.secret ? "password" : "text"} autoComplete="off" value={values[field.key] ?? ""} onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))} placeholder={field.label} className="rounded bg-zinc-950 p-2" />)}
      <button disabled={busy} className="rounded bg-cyan-500 px-3 py-2 font-medium text-zinc-950 disabled:opacity-50">Replace credentials</button>
    </form>}
    {open === "auto" && rotator && <form className="grid gap-2" onSubmit={event => { event.preventDefault(); void send({ action: "configure", accountId, ...(rotatorSecret.trim() ? { rotatorSecret: rotatorSecret.trim() } : {}), scheduleDays: days.trim() ? Number(days) : null }, () => { setRotatorSecret(""); setOpen(null); }); }}>
      <p className="text-zinc-400">{rotator.rotatorHint}</p>
      <input aria-label="Rotation credential" type="password" autoComplete="off" required={!info?.rotatorConfigured} value={rotatorSecret} onChange={event => setRotatorSecret(event.target.value)} placeholder={info?.rotatorConfigured ? "Rotation credential (leave empty to keep)" : "Rotation credential"} className="rounded bg-zinc-950 p-2" />
      <input aria-label="Rotate every N days" type="number" min={1} max={365} value={days} onChange={event => setDays(event.target.value)} placeholder="Rotate every N days (empty = manual only)" className="rounded bg-zinc-950 p-2" />
      <div className="flex gap-2"><button disabled={busy} className="rounded bg-cyan-500 px-3 py-2 font-medium text-zinc-950 disabled:opacity-50">Save</button>
      {info?.rotatorConfigured && <button type="button" disabled={busy} onClick={() => void send({ action: "configure", accountId, removeRotator: true }, () => setOpen(null))} className="rounded border border-rose-800 px-3 py-2 text-rose-300 disabled:opacity-50">Remove rotation credential</button>}</div>
    </form>}
  </div>;
}
