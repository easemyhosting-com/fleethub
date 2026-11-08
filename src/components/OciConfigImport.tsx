"use client";

import { useEffect, useMemo, useState } from "react";
import { IdentityPicker, resolveIdentity, useIdentities } from "./IdentityPicker";
import { choiceEmail, choiceIsValid, suggestIdentity, type IdentityChoice } from "@/lib/identity/picker";
import { testCredential, followFirstScan } from "@/lib/providers/client";
import { guessOwnerEmail, duplicateTenancies, matchOciKeys, ociRegistration, parseOciConfig, type OciKeyFile } from "@/lib/providers/oci-config";
import { forgetIgnored, loadIgnored, mergeIgnored, profileFingerprint, saveIgnored } from "@/lib/providers/oci-ignored";

type Outcome = { ok: boolean; message: string; accountId?: string };

const isConfigText = (text: string) => /^\s*\[[^\]]+\]/m.test(text) && /^\s*tenancy\s*=/im.test(text);

async function register(body: unknown): Promise<Outcome> {
  try {
    const response = await fetch("/api/providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data: unknown = await response.json().catch(() => ({}));
    const error = typeof data === "object" && data !== null && typeof (data as Record<string, unknown>).error === "string" ? String((data as Record<string, unknown>).error) : null;
    const account = typeof data === "object" && data !== null ? (data as { account?: { id?: unknown } }).account : undefined;
    return response.ok ? { ok: true, message: "Connected. Collection queued.", accountId: typeof account?.id === "string" ? account.id : undefined } : { ok: false, message: error ?? "Registration failed" };
  } catch { return { ok: false, message: "Could not reach FleetHub" }; }
}

/** Upload an OCI CLI config, see every account in it, give each its PEM key (or add all keys at once) and connect the ticked ones. */
export function OciConfigImport({ ownerEmail, onFinished }: { ownerEmail: string; onFinished: (allConnected: boolean) => void }) {
  const [configText, setConfigText] = useState("");
  const [keys, setKeys] = useState<OciKeyFile[]>([]);
  const [own, setOwn] = useState<Record<string, OciKeyFile>>({});
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const identities = useIdentities();
  const [choices, setChoices] = useState<Record<string, IdentityChoice | null>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, Outcome>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [fingerprints, setFingerprints] = useState<Record<string, string>>({});
  const profiles = useMemo(() => parseOciConfig(configText), [configText]);
  const duplicates = useMemo(() => duplicateTenancies(profiles), [profiles]);
  const candidates = useMemo(() => profiles.map(profile => matchOciKeys([profile], own[profile.profile] ? [own[profile.profile]] : keys.filter(key => profiles.some(other => other.keyFile && other.keyFile.split(/[\\/]/).pop()?.toLowerCase() === key.name.toLowerCase())))[0]), [profiles, keys, own]);

  // localStorage is client-only, so load after mount to keep server and client markup identical.
  useEffect(() => { setIgnored(loadIgnored()); }, []);
  useEffect(() => {
    let live = true;
    const compute = async () => {
      const pairs = await Promise.all(profiles.map(async profile => [profile.profile, await profileFingerprint(profile)] as const));
      if (live) setFingerprints(Object.fromEntries(pairs));
    };
    void compute().catch(() => { if (live) setFingerprints({}); });
    return () => { live = false; };
  }, [profiles]);

  async function read(file: File | undefined): Promise<string | null> {
    if (!file || file.size > 64 * 1024) { setNote("That file is too large to be an OCI config or key."); return null; }
    return file.text();
  }
  async function addConfig(file: File | undefined) {
    const text = await read(file);
    if (text === null) return;
    if (!isConfigText(text)) { setNote("That does not look like an OCI config (no [profile] with tenancy=). Pick the file named config."); return; }
    setNote(null); setConfigText(text); setResults({});
  }
  async function addAllKeys(files: FileList | null) {
    const added: OciKeyFile[] = [];
    for (const file of Array.from(files ?? [])) { const content = await read(file); if (content !== null) added.push({ name: file.name, content }); }
    setKeys(current => [...current.filter(key => !added.some(item => item.name === key.name)), ...added]);
  }
  async function addOwnKey(profile: string, file: File | undefined) {
    const content = await read(file);
    if (content !== null && file) setOwn(current => ({ ...current, [profile]: { name: file.name, content } }));
  }

  const choiceOf = (candidate: { profile: string; keyFile: string | null }): IdentityChoice | null => {
    if (candidate.profile in choices) return choices[candidate.profile];
    if (identities === null) return null;
    return suggestIdentity(identities, guessOwnerEmail(own[candidate.profile]?.name, candidate.keyFile));
  };
  const ignoredSet = useMemo(() => new Set(ignored), [ignored]);
  const isIgnored = (candidate: { profile: string; problem: string | null }) => {
    if (candidate.problem !== null) return false;
    const fingerprint = fingerprints[candidate.profile];
    return fingerprint !== undefined && ignoredSet.has(fingerprint);
  };
  const isPicked = (candidate: { profile: string; problem: string | null }) => picked[candidate.profile] ?? (!(candidate.profile in duplicates) && !isIgnored(candidate));
  const chosen = candidates.filter(candidate => candidate.problem === null && isPicked(candidate));
  function include(candidate: { profile: string }) {
    const fingerprint = fingerprints[candidate.profile];
    if (fingerprint) setIgnored(current => saveIgnored(forgetIgnored(current, [fingerprint])));
    setPicked(current => ({ ...current, [candidate.profile]: true }));
  }
  async function test(candidate: (typeof candidates)[number]) {
    setBusy(true); setResults(current => ({ ...current, [candidate.profile]: { ok: true, message: "Testing…" } }));
    const outcome = await testCredential("oracle", ociRegistration(candidate, candidate.profile, ownerEmail).config ?? {});
    setResults(current => ({ ...current, [candidate.profile]: outcome }));
    setBusy(false);
  }
  async function connect() {
    setBusy(true); setResults({});
    let ok = 0;
    const created = new Map<string, string>();
    for (const candidate of chosen) {
      const choice = choiceOf(candidate);
      let outcome: Outcome;
      try {
        if (!choice) throw new Error("Choose who this account belongs to");
        // Two accounts for the same new person share one identity.
        const key = choice.mode === "new" ? choice.email.trim().toLowerCase() : "";
        let identityId = key ? created.get(key) : undefined;
        if (!identityId) { identityId = await resolveIdentity(choice); if (key) created.set(key, identityId); }
        const label = (labels[candidate.profile] ?? `OCI ${candidate.profile}`).trim() || candidate.profile;
        const email = choiceEmail(identities ?? [], choice);
        outcome = await register({ ...ociRegistration(candidate, label, ownerEmail), ownerEmail: email ?? undefined, identityId });
      } catch (error) { outcome = { ok: false, message: error instanceof Error ? error.message : "Registration failed" }; }
      if (outcome.ok) ok += 1;
      setResults(current => ({ ...current, [candidate.profile]: outcome }));
      if (outcome.ok && outcome.accountId) void followFirstScan(outcome.accountId, step => setResults(current => ({ ...current, [candidate.profile]: step })));
    }
    setBusy(false);
    // Profiles the owner left unticked on purpose stay ignored next time; duplicates unticked by default do not.
    const leftUnticked = candidates.filter(candidate => candidate.problem === null && (picked[candidate.profile] === false || (picked[candidate.profile] !== true && isIgnored(candidate))));
    const remember = leftUnticked.map(candidate => fingerprints[candidate.profile]).filter((fingerprint): fingerprint is string => typeof fingerprint === "string");
    if (remember.length > 0) setIgnored(current => saveIgnored(mergeIgnored(current, remember)));
    if (ok > 0) onFinished(ok === chosen.length);
  }

  return (
    <div className="space-y-4 text-sm">
      <div>
        <label className="block text-xs font-semibold text-zinc-300" htmlFor="oci-config-file">1. Upload your OCI config file</label>
        <p className="mb-1 text-xs text-zinc-500">The file named <code>config</code> in <code>~/.oci</code> (press Cmd+Shift+. in the file dialog to show hidden folders). It lists your accounts; no secrets are in it.</p>
        <input id="oci-config-file" type="file" onChange={event => void addConfig(event.target.files?.[0])} className="block w-full text-zinc-300 file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-100" />
        <details className="mt-1 text-xs text-zinc-500"><summary className="cursor-pointer">Or paste the config text</summary>
          <textarea aria-label="OCI config text" rows={5} spellCheck={false} value={configText} onChange={event => setConfigText(event.target.value)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 p-2 font-mono text-zinc-200" />
        </details>
      </div>
      {note && <p role="alert" className="text-xs text-amber-300">{note}</p>}
      {candidates.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-zinc-300">2. Give each account its PEM key, then tick the ones to connect</p>
          <label className="mt-1 block text-xs text-zinc-500">Shortcut: select all your .pem files at once and they are matched by name.
            <input type="file" multiple aria-label="All PEM key files" onChange={event => void addAllKeys(event.target.files)} className="mt-1 block w-full text-zinc-300 file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-100" />
          </label>
          <ul className="mt-2 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
            {candidates.map(candidate => {
              const blocked = candidate.problem !== null;
              const result = results[candidate.profile];
              const ignoredEarlier = isIgnored(candidate);
              return (
                <li key={candidate.profile} className="space-y-2 p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <input type="checkbox" aria-label={`Connect ${candidate.profile}`} disabled={blocked || busy} checked={!blocked && isPicked(candidate)} onChange={event => setPicked(current => ({ ...current, [candidate.profile]: event.target.checked }))} />
                    <p className="min-w-0 flex-1 text-zinc-100">{candidate.profile} <span className="text-xs text-zinc-500">{candidate.region || "no region"} · …{candidate.tenancy.slice(-8)}</span></p>
                    {ignoredEarlier && (
                      <span className="flex items-center gap-2 text-xs">
                        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-amber-300" title="You left this profile unticked in an earlier upload">ignored earlier</span>
                        <button type="button" disabled={busy} onClick={() => include(candidate)} className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-200 disabled:opacity-50">Include</button>
                      </span>
                    )}
                    <input aria-label={`Label for ${candidate.profile}`} disabled={blocked || busy} value={labels[candidate.profile] ?? `OCI ${candidate.profile}`} onChange={event => setLabels(current => ({ ...current, [candidate.profile]: event.target.value }))} className="w-44 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100" />
                  </div>
                  <IdentityPicker label={`Person for ${candidate.profile}`} identities={identities} choice={choiceOf(candidate)} disabled={busy || blocked} onChange={choice => setChoices(current => ({ ...current, [candidate.profile]: choice }))} />
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <label className="text-zinc-400">PEM key{candidate.keyFile ? ` (config says ${candidate.keyFile.split(/[\\/]/).pop()})` : ""}:
                      <input type="file" aria-label={`PEM key for ${candidate.profile}`} onChange={event => void addOwnKey(candidate.profile, event.target.files?.[0])} className="ml-2 text-zinc-300 file:mr-2 file:rounded file:border-0 file:bg-zinc-800 file:px-2 file:py-1 file:text-zinc-100" />
                    </label>
                    {!blocked && <span className="text-emerald-300">key ready</span>}
                    {!blocked && <button type="button" disabled={busy} onClick={() => void test(candidate)} className="rounded border border-zinc-700 px-2 py-1 text-zinc-200 disabled:opacity-50">Test connection</button>}
                  </div>
                  {blocked && <p className="text-xs text-amber-300">{candidate.problem}</p>}
                  {candidate.profile in duplicates && <p className="text-xs text-amber-300">Same tenancy as “{duplicates[candidate.profile]}”, so it is left unticked. Tick it only if this is a different user you want tracked separately.</p>}
                  {result && <p role="status" className={`text-xs ${result.ok ? "text-emerald-300" : "text-rose-300"}`}>{result.message}</p>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="text-xs text-zinc-500">A read-only IAM user is safest. OCI accounts are protected: FleetHub never stops them.</p>
      <button type="button" disabled={busy || chosen.length === 0 || chosen.some(candidate => !choiceIsValid(choiceOf(candidate)))} onClick={() => void connect()} className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-black disabled:opacity-50">{busy ? "Connecting…" : `Connect ${chosen.length} account${chosen.length === 1 ? "" : "s"}`}</button>
    </div>
  );
}
