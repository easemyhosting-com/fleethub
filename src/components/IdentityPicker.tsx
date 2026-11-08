"use client";

import { useEffect, useState } from "react";
import { choiceEmail, choiceIsValid, pickerIdentities, type IdentityChoice, type PickerIdentity } from "@/lib/identity/picker";

const NEW = "__new__";

/** Loads the people FleetHub knows (identities with their primary email) once. */
export function useIdentities() {
  const [identities, setIdentities] = useState<PickerIdentity[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/identities", { cache: "no-store" })
      .then(response => (response.ok ? response.json() : null))
      .then((data: unknown) => {
        const list = typeof data === "object" && data !== null && Array.isArray((data as { identities?: unknown }).identities) ? (data as { identities: Parameters<typeof pickerIdentities>[0] }).identities : [];
        if (!cancelled) setIdentities(pickerIdentities(list));
      })
      .catch(() => { if (!cancelled) setIdentities([]); });
    return () => { cancelled = true; };
  }, []);
  return identities;
}

async function post(body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch("/api/identities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not save the identity");
  return data;
}

/** Turns a choice into an identity id, creating the person and their primary email first when it is new. */
export async function resolveIdentity(choice: IdentityChoice): Promise<string> {
  if (choice.mode === "existing") return choice.identityId;
  const created = await post({ action: "create_identity", displayName: choice.name.trim() });
  const identityId = String(created.identityId);
  await post({ action: "add_contact", identityId, kind: "email", value: choice.email.trim(), isPrimary: true });
  return identityId;
}

interface Props { label: string; identities: PickerIdentity[] | null; choice: IdentityChoice | null; onChange: (choice: IdentityChoice | null) => void; disabled?: boolean }

/** Which person owns this account: an existing identity, or a new one with a name and email. */
export function IdentityPicker({ label, identities, choice, onChange, disabled }: Props) {
  const person = choice?.mode === "existing" ? (identities ?? []).find(identity => identity.id === choice.identityId) : undefined;
  const value = !choice ? "" : choice.mode === "existing" ? choice.identityId : NEW;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
      <span>Belongs to</span>
      <select aria-label={label} disabled={disabled || identities === null} value={value} onChange={event => {
        const next = event.target.value;
        onChange(next === "" ? null : next === NEW ? { mode: "new", name: choice?.mode === "new" ? choice.name : "", email: choice?.mode === "new" ? choice.email : "" } : { mode: "existing", identityId: next });
      }} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100">
        <option value="">Choose a person…</option>
        {(identities ?? []).map(identity => <option key={identity.id} value={identity.id} disabled={!identity.email}>{identity.displayName}{identity.email ? ` (${identity.email})` : " (no email)"}</option>)}
        <option value={NEW}>+ New person…</option>
      </select>
      {choice?.mode === "existing" && person && <>
        <span>Email</span>
        <select aria-label={`${label}: email`} disabled={disabled} value={choiceEmail(identities ?? [], choice) ?? ""} onChange={event => onChange({ mode: "existing", identityId: choice.identityId, email: event.target.value })} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100">
          {person.emails.map(email => <option key={email} value={email}>{email}</option>)}
        </select>
      </>}
      {choice?.mode === "new" && <>
        <input aria-label={`${label}: name`} placeholder="Name" disabled={disabled} value={choice.name} onChange={event => onChange({ ...choice, name: event.target.value })} className="w-36 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100" />
        <input aria-label={`${label}: email`} type="email" placeholder="email" disabled={disabled} value={choice.email} onChange={event => onChange({ ...choice, email: event.target.value })} className="w-56 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100" />
      </>}
      {choice && !choiceIsValid(choice) && <span className="text-amber-300">Add a name and a valid email</span>}
    </div>
  );
}
