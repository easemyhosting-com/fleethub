"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

const keySchema = z.object({ id: z.string(), label: z.string(), hint: z.string(), createdBy: z.string(), expiresAt: z.string(), revokedAt: z.string().nullable(), lastUsedAt: z.string().nullable(), status: z.enum(["active", "expired", "revoked"]) });
const listSchema = z.object({ keys: z.array(keySchema) });
const createdSchema = z.object({ key: z.string(), label: z.string(), expiresAt: z.string() });
const when = (value: string | null) => value ? new Date(value).toLocaleString() : "never";

export function AgentAccessPanel() {
  const [keys, setKeys] = useState<z.infer<typeof keySchema>[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "signin" | "error">("loading");
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(30);
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState<z.infer<typeof createdSchema> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/agent-keys", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) { setState("signin"); return; }
      const parsed = listSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error("unavailable");
      setKeys(parsed.data.keys); setState("ready");
    } catch { setState("error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/agent-keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label, expiresInDays: days }) });
      const body = await response.json();
      const parsed = createdSchema.safeParse(body);
      if (!response.ok || !parsed.success) { setMessage(typeof body?.error === "string" ? body.error : "Could not create the key."); return; }
      setCreated(parsed.data); setLabel(""); await load();
    } catch { setMessage("Could not reach FleetHub."); } finally { setBusy(false); }
  };

  const revoke = async (id: string) => {
    setMessage("");
    const response = await fetch(`/api/agent-keys?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) setMessage("Could not revoke the key.");
    await load();
  };

  if (state === "loading") return <div role="status" className="rounded-xl border border-zinc-800 p-8 text-zinc-300">Loading agent keys…</div>;
  if (state === "signin") return <section className="mx-auto max-w-2xl rounded-xl border border-zinc-800 bg-zinc-950 p-8"><h2 className="text-xl font-semibold text-white">Sign in as operator</h2><p className="mt-3 text-sm text-zinc-400">Agent keys are managed by a signed-in operator. Use Access &amp; Auth, then reopen this page.</p></section>;
  if (state === "error") return <section className="mx-auto max-w-2xl rounded-xl border border-amber-900 p-8 text-sm text-amber-300">Agent keys are unavailable. Check that the database is running, then reload.</section>;

  return <section className="mx-auto max-w-3xl space-y-6">
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
      <h2 className="text-lg font-semibold text-white">Agent keys</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-400">One read-only key per agent, so you can see which agent read FleetHub and cut one off without touching the others. A key can read inventory through the MCP server and read APIs. It can never change anything, and it cannot manage keys. Each key is shown once, expires, and can be revoked immediately.</p>
      <form onSubmit={create} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-zinc-300">Agent name<input required maxLength={80} value={label} onChange={event => setLabel(event.target.value)} placeholder="Claude Code on laptop" className="mt-1 block w-60 rounded border border-zinc-700 bg-zinc-900 p-2 text-sm" /></label>
        <label className="text-xs text-zinc-300">Expires in<select value={days} onChange={event => setDays(Number(event.target.value))} className="mt-1 block rounded border border-zinc-700 bg-zinc-900 p-2 text-sm">{[7, 30, 90].map(value => <option key={value} value={value}>{value} days</option>)}</select></label>
        <button type="submit" disabled={busy || !label.trim()} className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-black disabled:opacity-50">Create key</button>
      </form>
      {message ? <p role="alert" className="mt-3 text-sm text-amber-300">{message}</p> : null}
      {created ? <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4"><p className="text-xs font-semibold text-emerald-300">Copy this key for “{created.label}” now. It cannot be shown again.</p><code className="mt-2 block break-all rounded bg-black p-2 text-xs text-zinc-100">{created.key}</code><div className="mt-2 flex gap-3"><button type="button" onClick={() => void navigator.clipboard?.writeText(created.key)} className="text-xs font-semibold text-emerald-300 hover:underline">Copy</button><button type="button" onClick={() => setCreated(null)} className="text-xs text-zinc-400 hover:underline">I have saved it</button></div></div> : null}
    </div>
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
      <h3 className="text-sm font-semibold text-white">Existing keys</h3>
      {keys.length === 0 ? <p className="mt-3 text-sm text-zinc-400">No agent keys yet.</p> : <ul className="mt-3 divide-y divide-zinc-800">{keys.map(key => <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm text-white">{key.label} <span className="font-mono text-xs text-zinc-500">…{key.hint}</span></p><p className="text-xs text-zinc-400">{key.status === "revoked" ? `Revoked ${when(key.revokedAt)}` : key.status === "expired" ? `Expired ${when(key.expiresAt)}` : `Expires ${when(key.expiresAt)}`} · Last used {when(key.lastUsedAt)} · by {key.createdBy}</p></div><div className="flex items-center gap-3"><span className={`rounded px-2 py-0.5 text-[10px] font-mono ${key.status === "active" ? "bg-emerald-500/10 text-emerald-300" : "bg-zinc-800 text-zinc-400"}`}>{key.status}</span>{key.status === "active" ? <button type="button" onClick={() => void revoke(key.id)} className="text-xs text-red-300 hover:underline">Revoke</button> : null}</div></li>)}</ul>}
      <p className="mt-3 text-xs text-zinc-500">Last used is recorded at most once an hour.</p>
    </div>
  </section>;
}
