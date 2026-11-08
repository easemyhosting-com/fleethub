"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { QrCode } from "@/components/QrCode";
import { buildPairLink, connectionResult, formatRemaining } from "@/lib/pairing/link";

const sessionSchema = z.object({ id: z.string(), kind: z.enum(["browser", "device"]), scope: z.enum(["read", "operator"]), label: z.string(), userEmail: z.string(), lastSeenAt: z.string().nullable(), expiresAt: z.string(), revokedAt: z.string().nullable(), status: z.enum(["active", "expired", "revoked"]) });
const pairingSchema = z.object({ id: z.string(), label: z.string(), scope: z.enum(["read", "operator"]), expiresAt: z.string(), status: z.enum(["pending", "expired", "used", "cancelled"]) });
const optionsSchema = z.object({ enabled: z.boolean(), qr: z.boolean(), maxScope: z.enum(["read", "operator"]) });
const createdSchema = z.object({ id: z.string(), code: z.string(), label: z.string(), scope: z.enum(["read", "operator"]), expiresAt: z.string() });
const when = (value: string | null) => value ? new Date(value).toLocaleString() : "never";

export function DevicesPanel() {
  const [sessions, setSessions] = useState<z.infer<typeof sessionSchema>[]>([]);
  const [pairings, setPairings] = useState<z.infer<typeof pairingSchema>[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "signin" | "error">("loading");
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<"read" | "operator">("read");
  const [minutes, setMinutes] = useState(10);
  const [created, setCreated] = useState<z.infer<typeof createdSchema> | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [connected, setConnected] = useState<{ label: string; scope: "read" | "operator" } | null>(null);
  const [copied, setCopied] = useState("");
  const [confirmOthers, setConfirmOthers] = useState(false);
  const [options, setOptions] = useState({ enabled: true, qr: true, maxScope: "operator" as "read" | "operator" });

  const load = useCallback(async () => {
    try {
      const [sessionResponse, pairingResponse] = await Promise.all([fetch("/api/sessions", { cache: "no-store" }), fetch("/api/devices/pairing", { cache: "no-store" })]);
      if ([sessionResponse.status, pairingResponse.status].some(status => status === 401 || status === 403)) { setState("signin"); return; }
      const sessionBody = z.object({ sessions: z.array(sessionSchema), currentId: z.string().nullable() }).safeParse(await sessionResponse.json());
      const pairingBody = z.object({ pairings: z.array(pairingSchema), options: optionsSchema }).safeParse(await pairingResponse.json());
      if (!sessionResponse.ok || !pairingResponse.ok || !sessionBody.success || !pairingBody.success) throw new Error("unavailable");
      setSessions(sessionBody.data.sessions); setCurrentId(sessionBody.data.currentId); setPairings(pairingBody.data.pairings); setOptions(pairingBody.data.options); if (pairingBody.data.options.maxScope === "read") setScope("read"); setState("ready");
    } catch { setState(previous => previous === "ready" ? "ready" : "error"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const waiting = pairings.some(item => item.status === "pending");
  useEffect(() => {
    if (!waiting && !created) return;
    const poll = setInterval(() => void load(), 2500);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [waiting, created, load]);

  useEffect(() => {
    if (!created) return;
    const result = connectionResult(created.id, pairings);
    if (result.kind === "connected") { setConnected({ label: result.label, scope: result.scope }); setCreated(null); }
  }, [created, pairings]);

  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(""), 2000); } catch { setMessage("Copy was blocked by the browser. Select the text and copy it manually."); }
  };

  const call = async (url: string, method: string, body?: unknown) => {
    setMessage("");
    const response = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
    const data = await response?.json().catch(() => null);
    if (!response?.ok) setMessage(typeof data?.error === "string" ? data.error : "The request failed.");
    return response?.ok ? data : null;
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setConnected(null);
    const data = await call("/api/devices/pairing", "POST", { label, scope, expiresInMinutes: minutes });
    const parsed = createdSchema.safeParse(data);
    if (parsed.success) { setCreated(parsed.data); setLabel(""); }
    await load(); setBusy(false);
  };

  if (state === "loading") return <div role="status" className="rounded-xl border border-zinc-800 p-8 text-zinc-300">Loading devices and sessions…</div>;
  if (state === "signin") return <section className="mx-auto max-w-2xl rounded-xl border border-zinc-800 bg-zinc-950 p-8"><h2 className="text-xl font-semibold text-white">Sign in as operator</h2><p className="mt-3 text-sm text-zinc-400">Only a signed-in operator session can pair devices and manage sessions. A read-only device cannot.</p></section>;
  if (state === "error") return <section className="mx-auto max-w-2xl rounded-xl border border-amber-900 p-8 text-sm text-amber-300">Sessions are unavailable. Check that the database is running, then reload.</section>;

  const pairUrl = typeof window === "undefined" ? "/pair" : `${window.location.origin}/pair`;
  return <section className="mx-auto max-w-3xl space-y-6">
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
      <h2 className="text-lg font-semibold text-white">Pair a device</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-400">Create a one-time code, then open <code className="text-zinc-200">{pairUrl}</code> on the new device and enter it. The device gets its own session for 30 days that you can revoke any time. Prefer <strong>Read-only</strong>: such a device can look but never change anything.</p>
      <form onSubmit={create} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-zinc-300">Device name<input required maxLength={80} value={label} onChange={event => setLabel(event.target.value)} placeholder="My iPhone" className="mt-1 block w-52 rounded border border-zinc-700 bg-zinc-900 p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" /></label>
        <label className="text-xs text-zinc-300">Access<select value={scope} onChange={event => setScope(event.target.value as "read" | "operator")} className="mt-1 block rounded border border-zinc-700 bg-zinc-900 p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"><option value="read">Read-only</option>{options.maxScope === "operator" ? <option value="operator">Operator (can change things)</option> : null}</select></label>
        <label className="text-xs text-zinc-300">Code valid for<select value={minutes} onChange={event => setMinutes(Number(event.target.value))} className="mt-1 block rounded border border-zinc-700 bg-zinc-900 p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">{[5, 10, 30].map(value => <option key={value} value={value}>{value} minutes</option>)}</select></label>
        <button type="submit" disabled={busy || !label.trim() || !options.enabled} className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-black disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">Create code</button>
      </form>
      {!options.enabled ? <p role="alert" className="mt-3 text-sm text-amber-300">Device pairing is turned off on this server (FLEETHUB_DEVICE_PAIRING). Existing devices keep working until you revoke them.</p> : null}
      {scope === "operator" ? <p className="mt-3 text-xs text-amber-300">An operator device can change FleetHub like this browser can. Pair only a device you control.</p> : null}
      {message ? <p role="alert" className="mt-3 text-sm text-amber-300">{message}</p> : null}
      {connected ? <div role="status" className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4"><p className="text-sm font-semibold text-emerald-300">✓ Connected: {connected.label}</p><p className="mt-1 text-xs text-zinc-300">This device is signed in as {connected.scope === "read" ? "read-only" : "an operator"}. It appears under Sessions below, where you can revoke it any time.</p><button type="button" onClick={() => setConnected(null)} className="mt-2 text-xs text-zinc-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">Dismiss</button></div> : null}
      {created ? (() => {
        const remaining = formatRemaining(created.expiresAt, now);
        const link = buildPairLink(window.location.origin, created.code);
        return <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="text-xs font-semibold text-emerald-300">{remaining ? `Waiting for “${created.label}” to connect… code expires in ${remaining}` : "This code has expired. Create a new one."}</p>
          {remaining ? <div className="mt-3 flex flex-wrap items-start gap-5">
            {options.qr ? <div className="space-y-2"><p className="text-xs text-zinc-400">1. On the new device, scan this QR code with its camera</p><QrCode value={link} label="QR code that opens the pairing page with the code filled in" /></div> : null}
            <div className="min-w-0 flex-1 space-y-3">
              {options.qr ? <div><p className="text-xs text-zinc-400">Or send the link (the code is inside it)</p><div className="mt-1 flex flex-wrap gap-2"><button type="button" onClick={() => void copy(link, "link")} className="rounded border border-zinc-600 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">{copied === "link" ? "Link copied ✓" : "Copy link"}</button>{typeof navigator !== "undefined" && "share" in navigator ? <button type="button" onClick={() => void navigator.share({ title: "Pair with FleetHub", url: link }).catch(() => undefined)} className="rounded border border-zinc-600 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">Share…</button> : null}</div></div> : null}
              <div><p className="text-xs text-zinc-400">{options.qr ? "Or type" : "Type"} this code at <span className="text-zinc-200">/pair</span></p><div className="mt-1 flex flex-wrap items-center gap-2"><code className="min-w-0 break-all rounded bg-black px-3 py-2 text-base tracking-widest text-zinc-100">{created.code}</code><button type="button" onClick={() => void copy(created.code, "code")} className="rounded border border-zinc-600 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">{copied === "code" ? "Copied ✓" : "Copy"}</button></div></div>
              <p className="text-xs text-zinc-500">{created.scope === "read" ? "Read-only" : "Operator"} access. Works once and cannot be shown again. This page updates by itself when the device connects.</p>
            </div>
          </div> : null}
          <button type="button" onClick={() => setCreated(null)} className="mt-3 text-xs text-zinc-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">Hide</button>
        </div>;
      })() : null}
      {pairings.some(item => item.status === "pending") ? <ul className="mt-4 divide-y divide-zinc-800 text-sm">{pairings.filter(item => item.status === "pending").map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2"><span className="min-w-0 break-words text-zinc-300">{item.label} · {item.scope === "read" ? "read-only" : "operator"} · expires {when(item.expiresAt)}</span><button type="button" onClick={() => void call(`/api/devices/pairing?id=${encodeURIComponent(item.id)}`, "DELETE").then(load)} className="text-xs text-red-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">Cancel</button></li>)}</ul> : null}
    </div>
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold text-white">Sessions</h3>{confirmOthers ? <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirm sign out everywhere else"><span className="text-xs text-zinc-300">Sign out every other session?</span><button type="button" autoFocus onClick={() => { setConfirmOthers(false); void call("/api/sessions?others=true", "DELETE").then(load); }} className="rounded border border-red-800 px-2 py-1 text-xs text-red-300 hover:bg-red-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">Yes, sign out</button><button type="button" onClick={() => setConfirmOthers(false)} className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">Keep them</button></div> : <button type="button" onClick={() => setConfirmOthers(true)} className="text-xs text-red-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">Sign out everywhere else</button>}</div>
      {sessions.length === 0 ? <p className="mt-3 text-sm text-zinc-400">No sessions recorded yet.</p> : <ul className="mt-3 divide-y divide-zinc-800">{sessions.map(item => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0 flex-1"><p className="break-words text-sm text-white">{item.label} {item.id === currentId ? <span className="ml-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-mono text-emerald-300">this session</span> : null}</p><p className="break-words text-xs text-zinc-400">{item.kind === "device" ? "Paired device" : "Browser sign-in"} · {item.scope === "read" ? "read-only" : "operator"} · last seen {when(item.lastSeenAt)} · {item.status === "revoked" ? `revoked ${when(item.revokedAt)}` : `expires ${when(item.expiresAt)}`}</p></div><div className="flex items-center gap-3"><span className={`rounded px-2 py-0.5 text-[10px] font-mono ${item.status === "active" ? "bg-emerald-500/10 text-emerald-300" : "bg-zinc-800 text-zinc-400"}`}>{item.status}</span>{item.status === "active" ? <button type="button" onClick={() => void call(`/api/sessions?id=${encodeURIComponent(item.id)}`, "DELETE").then(load)} className="text-xs text-red-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">Revoke</button> : null}</div></li>)}</ul>}
      <p className="mt-3 text-xs text-zinc-500">Revoking a session signs it out immediately. Last seen is recorded at most once an hour.</p>
    </div>
  </section>;
}
